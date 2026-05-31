import JSZip from "jszip";

export async function downloadFolderZip(folder) {
    const zip = new JSZip();

    Object.entries(folder.files).forEach(([fileName, raw]) => {
        zip.file(fileName, raw);
    });

    const blob = await zip.generateAsync({ type: "blob" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folder.folderName}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}