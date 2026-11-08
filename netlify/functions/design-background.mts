// Netlify Background Function (name ends with "-background"): runs up to 15 minutes.
// Started by /api/design with { jobId }; the job input is already stored in Blobs.
import { runJob, validJobId } from "../../lib/server/designJobs";

export default async (req: Request) => {
  const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
  if (jobId && validJobId(jobId)) await runJob(jobId);
};
