import { redirect } from "next/navigation";

/** Canonical assistant home is `/`; keep this route for existing links. */
export default function AssistantPage() {
  redirect("/");
}
