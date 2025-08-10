import {getBearerToken, validateJWT} from "../auth";
import {respondWithJSON} from "./json";
import {getVideo, updateVideo} from "../db/videos";
import type {ApiConfig} from "../config";
import {type BunRequest} from "bun";
import {BadRequestError, NotFoundError, UserForbiddenError} from "./errors";

// type Thumbnail = {
// 	data: ArrayBuffer;
// 	mediaType: string;
// };

// const videoThumbnails: Map<string, Thumbnail> = new Map();

// export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
// 	const {videoId} = req.params as {videoId?: string};
// 	if (!videoId) {
// 		throw new BadRequestError("Invalid video ID");
// 	}

// 	const video = getVideo(cfg.db, videoId);
// 	if (!video) {
// 		throw new NotFoundError("Couldn't find video");
// 	}

// 	const thumbnail = videoThumbnails.get(videoId);
// 	if (!thumbnail) {
// 		throw new NotFoundError("Thumbnail not found");
// 	}

// 	return new Response(thumbnail.data, {
// 		headers: {
// 			"Content-Type": thumbnail.mediaType,
// 			"Cache-Control": "no-store",
// 		},
// 	});
// }

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
	const imageData = await fileData.arrayBuffer();
  const imageDataBuffer = Buffer.from(imageData)
  const imageDataBase64 = imageDataBuffer.toString("base64")
  const dataBase64URL = `data:${fileDataType};base64,${imageDataBase64}`

	const vidMetaData = await getVideo(cfg.db, videoId);

	if (!vidMetaData) {
		throw new NotFoundError("Couldn't find video");
	}

	if (vidMetaData.userID != userID) {
		throw new UserForbiddenError(
			"video owner id doesnt match with loggen in user id"
		);
	}

	// videoThumbnails.set(vidMetaData.id, {
	// 	data: imageData,
	// 	mediaType: fileDataType,
	// });

	//const thumbnailURL = `http://localhost:${process.env.PORT}/api/thumbnails/${vidMetaData.id}`;

	//vidMetaData.thumbnailURL = thumbnailURL;

  vidMetaData.thumbnailURL = dataBase64URL
	updateVideo(cfg.db, vidMetaData);

	return respondWithJSON(200, vidMetaData);
}
