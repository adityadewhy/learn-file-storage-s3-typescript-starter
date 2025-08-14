import {respondWithJSON} from "./json";
import {type ApiConfig} from "../config";
import {type BunRequest} from "bun";
import {BadRequestError} from "./errors";
import {getBearerToken, validateJWT} from "../auth";
import {validate as uuidValidate} from "uuid";
import {getVideo, updateVideo} from "../db/videos";
import {NotFoundError, UserForbiddenError} from "./errors";
import {randomBytes} from "crypto";
import {unlink, mkdir} from "fs/promises";
import path from "path";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
	const {videoId} = req.params as {videoId?: string};
	if (!videoId) {
		throw new BadRequestError("invalid video id");
	}

	if (!uuidValidate(videoId)) {
		throw new BadRequestError("invalid uuid");
	}

	const token = getBearerToken(req.headers);
	const userID = validateJWT(token, cfg.jwtSecret);

	console.log("uploading video", videoId, "by user", userID);

	const vidMetaData = await getVideo(cfg.db, videoId);
	if (!vidMetaData) {
		throw new NotFoundError("Couldn't find video");
	}

	if (vidMetaData.userID !== userID) {
		throw new UserForbiddenError(
			"video owner id doesnt match with loggen in user id"
		);
	}

	const formData = await req.formData();
	const videoData = formData.get("video");
	if (!(videoData instanceof File)) {
		throw new BadRequestError("videoData not an instance of File");
	}

	const MAX_UPLOAD_SIZE = 1024 * 1024 * 1024; //1GB

	if (videoData.size > MAX_UPLOAD_SIZE) {
		throw new BadRequestError("file size exceeds 1GB");
	}

	const videoDataType = videoData.type;
	if (videoDataType !== "video/mp4") {
		throw new BadRequestError("wrong type of file selected, select mp4");
	}

	const generatedRandomBase64url = randomBytes(32).toString("base64url");

	const tempUrl = path.join(cfg.filepathRoot, "tmp");
	await mkdir(tempUrl, {recursive: true});
	await Bun.write(`${tempUrl}/${generatedRandomBase64url}.mp4`, videoData);

	//await S3Client.file(`${generatedRandomBase64url}.mp4`, Bun.file(`{cfg.assetsRoot}/tmp/${generatedRandomBase64url}.mp4`),"video/mp4")
	//https://<bucket-name>.s3.<region>.amazonaws.com/<key> this is the format

	const toUpload = cfg.s3Client.file(`${generatedRandomBase64url}.mp4`);

	try {
		await toUpload.write(
			Bun.file(`${tempUrl}/${generatedRandomBase64url}.mp4`)
		);
		vidMetaData.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${generatedRandomBase64url}.mp4`;
		await updateVideo(cfg.db, vidMetaData);
	} finally {
		await unlink(`${tempUrl}/${generatedRandomBase64url}.mp4`).catch(() => {});
	}

	return respondWithJSON(200, null);
}
