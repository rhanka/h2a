// src/routes/artifact/[id]/+page.server.ts
var load = ({ params }) => {
	const enabled = process.env.PUBLIC_FOCUS_ARTIFACT_REVIEW === "1" || process.env.PUBLIC_FOCUS_ARTIFACT_REVIEW === "true" || process.env.FOCUS_ARTIFACT_REVIEW === "1" || process.env.FOCUS_ARTIFACT_REVIEW === "true";
	return {
		artifactId: params.id,
		artifactVersion: "v1",
		reviewEnabled: enabled
	};
};
export { load };

//# sourceMappingURL=_page.server.ts.js.map