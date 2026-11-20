import { t as artifactReviewRoute } from "../../../../../../../chunks/runtime.js";
// src/routes/api/artifacts/[artifactId]/comments/[commentId]/+server.ts
var PATCH = artifactReviewRoute("comment.edit");
var DELETE = artifactReviewRoute("comment.remove");
var OPTIONS = artifactReviewRoute("preflight");
export { DELETE, OPTIONS, PATCH };

//# sourceMappingURL=_server.ts.js.map