import { downloadFolderZip } from "../../benchmark/downloadUtils";

export default function SampleDownloadCard({ sampleFolders }) {
  return (
    <div className="glass-card download-card">
      <div className="card-title">Sample Folder Downloads</div>

      <div className="sample-download-list">
        {sampleFolders.map((folder) => {
          const fileCount = Object.keys(folder.files).length;

          return (
            <button
              key={folder.folderName}
              onClick={() => downloadFolderZip(folder)}
              disabled={fileCount === 0}
              className="sample-download-button"
            >
              <div className="sample-download-row">
                <span className="sample-download-name">
                  Download {folder.label} ZIP
                </span>
                <span className="sample-download-count">
                  {fileCount} file(s)
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}