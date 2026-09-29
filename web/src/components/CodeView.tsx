import { useEffect, useState } from "react";
import { api } from "../api";

type File = { path: string; content: string };

export default function CodeView({ siteId, version }: { siteId: string; version: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [selected, setSelected] = useState("src/App.tsx");

  useEffect(() => {
    api.getFiles(siteId).then(setFiles).catch(() => setFiles([]));
  }, [siteId, version]);

  const file = files.find((f) => f.path === selected) ?? files[0];

  return (
    <div className="code">
      <ul className="code-files">
        {files.map((f) => (
          <li key={f.path}>
            <button className={f === file ? "active" : ""} onClick={() => setSelected(f.path)}>
              {f.path.replace(/^src\//, "")}
            </button>
          </li>
        ))}
      </ul>
      <pre className="code-body">
        <code>{file?.content ?? "No files yet."}</code>
      </pre>
    </div>
  );
}
