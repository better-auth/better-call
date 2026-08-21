import { createMDX } from "fumadocs-mdx/next";

/** @type {import("next").NextConfig} */
const config = {
	reactStrictMode: true,
	devIndicators: false,
};

export default createMDX()(config);
