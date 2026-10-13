// The test video's files, which ./wrangler.jsonc's rules have Wrangler bundle

declare module "*.m3u8" {
	const text: string;
	export default text;
}

declare module "*.vtt" {
	const text: string;
	export default text;
}

declare module "*.mp4" {
	const data: ArrayBuffer;
	export default data;
}
