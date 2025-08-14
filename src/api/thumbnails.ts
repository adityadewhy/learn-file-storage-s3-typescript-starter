import {getBearerToken, validateJWT} from "../auth";
import {respondWithJSON} from "./json";
import {getVideo, updateVideo} from "../db/videos";
import type {ApiConfig} from "../config";
import {type BunRequest} from "bun";
import {BadRequestError, NotFoundError, UserForbiddenError} from "./errors";
import path from "path";
import {randomBytes} from "crypto";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
	const {videoId} = req.params as {videoId?: string};
	if (!videoId) {
		throw new BadRequestError("Invalid video ID");
	}

	const token = getBearerToken(req.headers);
	const userID = validateJWT(token, cfg.jwtSecret);

	console.log("uploading thumbnail for video", videoId, "by user", userID);

	// TODO: implement the upload here
	const formData = await req.formData();
	const fileData = formData.get("thumbnail");
	if (!(fileData instanceof File)) {
		throw new BadRequestError("fileData not an instance of File");
	}

	const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; //10mb

	if (fileData.size > MAX_UPLOAD_SIZE) {
		throw new BadRequestError("file size exceeds 10mb");
	}

	const fileDataType = fileData.type;
	console.log(fileDataType);

	if (fileDataType !== "image/jpeg" && fileDataType !== "image/png") {
		throw new BadRequestError(
			"wrong type of file selected, select either jpeg or png"
		);
	}

	const imageData = await fileData.arrayBuffer();
	const imageDataBuffer = Buffer.from(imageData);

	const vidMetaData = await getVideo(cfg.db, videoId);

	if (!vidMetaData) {
		throw new NotFoundError("Couldn't find video");
	}

	if (vidMetaData.userID != userID) {
		throw new UserForbiddenError(
			"video owner id doesnt match with loggen in user id"
		);
	}

	const file_extension = fileDataType.split("/")[1];
	const fileRandomUrl = randomBytes(32);
	const fileBase64RandomUrl = fileRandomUrl.toString("base64url");
	const assetsLocation = path.join(
		cfg.assetsRoot,
		`${fileBase64RandomUrl}.${file_extension}`
	);
	await Bun.write(assetsLocation, imageDataBuffer);

	vidMetaData.thumbnailURL = `http://localhost:${process.env.PORT}/assets/${fileBase64RandomUrl}.${file_extension}`;
	await updateVideo(cfg.db, vidMetaData);

	return respondWithJSON(200, vidMetaData);
}
