import Script from "next/script";
import { markup } from "./markup";

// The console is the pre-event UI shell, rendered as-is; public/ui.js owns all of its DOM.
export default function Page() {
  return (
    <>
      <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: markup }} />
      <Script src="/ui.js" strategy="afterInteractive" />
    </>
  );
}
