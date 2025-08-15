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

async function getVideoAspectRatio(
	filePath: string
): Promise<"landscape" | "portrait" | "other"> {
	const proc = Bun.spawn({
		cmd: [
			"ffprobe",
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height",
			"-of",
			"json",
			filePath,
		],
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdoutText = await new Response(proc.stdout).text();
	const stderrText = await new Response(proc.stderr).text();

	const exited = await proc.exited;
	if (exited !== 0) {
		throw new BadRequestError(`ffprobe failed: ${stderrText}`);
	}

	let result;
	try {
		result = JSON.parse(stdoutText);
	} catch {
		throw new BadRequestError("failed to parse json");
	}

	const width = result.streams[0].width;
	const height = result.streams[0].height;

	if (!width || !height) {
		throw new BadRequestError("Could not determine video dimensions");
	}

	const ratio = width / height;
	if (Math.abs(ratio - 16 / 9) < 0.01) {
		return "landscape";
	} else if (Math.abs(ratio - 9 / 16) < 0.01) {
		return "portrait";
	} else {
		return "other";
	}
}

async function processVideoForFastStart(inputFilePath: string) {
	const outputFilePath = `${inputFilePath}.processed.mp4`;

	const proc = Bun.spawn({
		cmd: [
			"ffmpeg",
			"-i",
			`${inputFilePath}`,
			"-movflags",
			"faststart",
			"-map_metadata",
			"0",
			"-codec",
			"copy",
			"-f",
			"mp4",
			outputFilePath,
		],
		stdout: "pipe",
		stderr: "pipe",
	});

	const stderrText = await new Response(proc.stderr).text();

	const exited = await proc.exited;
	if (exited !== 0) {
		throw new BadRequestError(`ffmpeg failed: ${stderrText}`);
	}

	return outputFilePath;
}

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

	const processedVideoPath = await processVideoForFastStart(
		`${tempUrl}/${generatedRandomBase64url}.mp4`
	);

	const orientation = await getVideoAspectRatio(`${processedVideoPath}`);
	const s3processedFileName = path.basename(`${processedVideoPath}`);

	//await S3Client.file(`${generatedRandomBase64url}.mp4`, Bun.file(`{cfg.assetsRoot}/tmp/${generatedRandomBase64url}.mp4`),"video/mp4")
	//https://<bucket-name>.s3.<region>.amazonaws.com/<key> this is the format

	const s3Key = `${orientation}/${s3processedFileName}`;
	const toUpload = cfg.s3Client.file(s3Key);

	try {
		await toUpload.write(Bun.file(`${processedVideoPath}`));
		vidMetaData.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Key}`;
		await updateVideo(cfg.db, vidMetaData);
	} finally {
		await unlink(`${tempUrl}/${generatedRandomBase64url}.mp4`).catch(() => {});
		await unlink(`${processedVideoPath}`).catch(() => {});
	}

	return respondWithJSON(200, null);
}
