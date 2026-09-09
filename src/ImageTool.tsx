import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { 
  Upload, 
  Trash2, 
  Download, 
  Image as ImageIcon, 
  Crop, 
  RefreshCw, 
  Compass, 
  Sliders, 
  Check, 
  X, 
  ShieldCheck, 
  FileArchive, 
  FolderDown, 
  Maximize, 
  Layers,
  Sparkles
} from "lucide-react";
import JSZip from "jszip";

interface UploadedImage {
  id: string;
  originalFile: File;
  originalUrl: string;
  croppedUrl: string | null;
  cropBox: { x: number; y: number; w: number; h: number } | null; // values as percentages (0-100)
  cropAspectRatio: string; // current active aspect ratio name on crop
  processedUrl: string;
  processedBlob: Blob;
  fileName: string;
  dimensions: { width: number; height: number };
  originalSize: number;
  processedSize: number;
}

type ResolutionPreset = "720p" | "1080p" | "2160p" | "original" | "custom_height";
type FileFormat = "image/jpeg" | "image/png" | "image/webp" | "image/avif" | "image/bmp";
type WatermarkPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "center";

interface FormatOption {
  value: FileFormat;
  label: string;
  ext: string;
  hint: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { value: "image/webp", label: "WEBP", ext: ".webp", hint: "Best size/quality for the web" },
  { value: "image/jpeg", label: "JPEG", ext: ".jpg", hint: "Universal compatibility" },
  { value: "image/png", label: "PNG", ext: ".png", hint: "Lossless, alpha support" },
  { value: "image/avif", label: "AVIF", ext: ".avif", hint: "Modern, smaller than WebP" },
  { value: "image/bmp", label: "BMP", ext: ".bmp", hint: "Uncompressed legacy format" },
];

// Which output encoders does THIS browser actually ship? AVIF/BMP encoding is
// not available everywhere (e.g. Safari cannot encode AVIF). Formats the
// browser cannot encode are surfaced as disabled buttons instead of failing
// silently at export time.
function detectSupportedFormats(): Promise<Set<string>> {
  return new Promise((resolve) => {
    const probe = (mime: string) =>
      new Promise<boolean>((res) => {
        try {
          const c = document.createElement("canvas");
          c.width = 2;
          c.height = 2;
          const ctx = c.getContext("2d");
          if (!ctx) {
            res(false);
            return;
          }
          ctx.fillStyle = "#B45DFF";
          ctx.fillRect(0, 0, 2, 2);
          c.toBlob((b) => res(!!b), mime, 0.8);
        } catch {
          res(false);
        }
      });
    Promise.all(FORMAT_OPTIONS.map((o) => probe(o.value))).then((results) => {
      const supported = new Set<string>();
      FORMAT_OPTIONS.forEach((o, i) => {
        if (results[i]) supported.add(o.value);
      });
      resolve(supported);
    });
  });
}

export default function ImageTool() {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  // Settings state
  const [resolution, setResolution] = useState<ResolutionPreset>("1080p");
  const [customHeight, setCustomHeight] = useState<number>(1080);
  const [format, setFormat] = useState<FileFormat>("image/webp");
  const [quality, setQuality] = useState<number>(90);

  // Encoders actually available in this browser (AVIF/BMP are browser-dependent)
  const [supportedFormats, setSupportedFormats] = useState<Set<string> | null>(null);

  useEffect(() => {
    detectSupportedFormats().then((supported) => {
      setSupportedFormats(supported);
      // Never strand the pipeline on a format this browser cannot encode.
      setFormat((current) => (supported.has(current) ? current : "image/webp"));
    });
  }, []);
  
  // Size Target
  const [useTargetSize, setUseTargetSize] = useState(false);
  const [targetSizeKB, setTargetSizeKB] = useState<number>(200);

  // Bulk rename
  const [renamePattern, setRenamePattern] = useState("");

  // Watermark state
  const [watermarkUrl, setWatermarkUrl] = useState<string | null>(null);
  const [watermarkImg, setWatermarkImg] = useState<HTMLImageElement | null>(null);
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>("bottom-right");
  const [watermarkSize, setWatermarkSize] = useState<number>(10); // 5% to 50%
  const [watermarkAlpha, setWatermarkAlpha] = useState<number>(30); // percentage
  const [watermarkFile, setWatermarkFile] = useState<File | null>(null);

  // Crop Modal state
  const [activeCropImage, setActiveCropImage] = useState<UploadedImage | null>(null);
  const [cropBoxPercent, setCropBoxPercent] = useState({ x: 10, y: 10, w: 80, h: 80 });
  const [cropAspect, setCropAspect] = useState<string>("Free");

  const dragAreaRef = useRef<HTMLDivElement>(null);
  const watermarkInitRef = useRef(false);

  // Load watermark from base64 or custom upload URL
  useEffect(() => {
    if (watermarkUrl) {
      const img = new window.Image();
      img.onload = () => {
        setWatermarkImg(img);
      };
      img.onerror = () => console.warn("Failed to load watermark image");
      img.src = watermarkUrl;
    } else {
      setWatermarkImg(null);
    }
  }, [watermarkUrl]);

  // Re-run the pipeline once the watermark element actually lands in state.
  // (Triggering inside img.onload would reprocess with the pre-commit
  // closure where watermarkImg is still null — the mark would never draw
  // until a manual "Apply Settings" pass. This effect fires after commit.)
  useEffect(() => {
    if (!watermarkInitRef.current) {
      watermarkInitRef.current = true;
      return;
    }
    if (images.length > 0) {
      reprocessImages(images);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watermarkImg]);

  // Handle manual trigger when settings are loaded or updated
  const handleWatermarkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setWatermarkFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setWatermarkUrl(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeWatermark = () => {
    setWatermarkFile(null);
    setWatermarkUrl(null);
    setWatermarkImg(null);
  };

  const handleFilesUpload = (files: FileList) => {
    const validFormats = ["image/jpeg", "image/png", "image/webp"];
    const fileArray = Array.from(files).filter(f => validFormats.includes(f.type));
    
    if (fileArray.length === 0) return;

    const newUploadedImages: UploadedImage[] = fileArray.map((file, idx) => {
      const uniqueId = `img_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 5)}`;
      const originalUrl = URL.createObjectURL(file);
      
      return {
        id: uniqueId,
        originalFile: file,
        originalUrl,
        croppedUrl: null,
        cropBox: null,
        cropAspectRatio: "Free",
        processedUrl: originalUrl, // initialized to original
        processedBlob: file,       // initialized to original file blob
        fileName: file.name,
        dimensions: { width: 0, height: 0 },
        originalSize: file.size,
        processedSize: file.size,
      };
    });

    const combinedImages = [...images, ...newUploadedImages];
    setImages(combinedImages);
    
    // Automatically process uploads with existing settings
    reprocessImages(combinedImages);
  };

  // Drag and drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesUpload(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesUpload(e.target.files);
    }
  };

  const deleteImage = (id: string) => {
    const target = images.find(img => img.id === id);
    if (target) {
      URL.revokeObjectURL(target.originalUrl);
      if (target.processedUrl && target.processedUrl !== target.originalUrl) {
        URL.revokeObjectURL(target.processedUrl);
      }
    }
    setImages(prev => prev.filter(img => img.id !== id));
  };

  const clearAllImages = () => {
    images.forEach(img => {
      URL.revokeObjectURL(img.originalUrl);
      if (img.processedUrl && img.processedUrl !== img.originalUrl) {
        URL.revokeObjectURL(img.processedUrl);
      }
    });
    setImages([]);
  };

  // Run the crop / edit setting pipeline
  const applyImagePipeline = async (
    uploaded: UploadedImage, 
    idx: number
  ): Promise<UploadedImage> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = async () => {
        // Setup calculation canvas
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(uploaded);
          return;
        }

        // 1. Source parameters: Handle custom crop first if active
        let srcX = 0;
        let srcY = 0;
        let srcW = img.naturalWidth;
        let srcH = img.naturalHeight;

        if (uploaded.cropBox) {
          srcX = (uploaded.cropBox.x / 100) * img.naturalWidth;
          srcY = (uploaded.cropBox.y / 100) * img.naturalHeight;
          srcW = (uploaded.cropBox.w / 100) * img.naturalWidth;
          srcH = (uploaded.cropBox.h / 100) * img.naturalHeight;
        }

        // 2. Compute dynamic resizing boundaries keeping aspect ratio
        let targetW = srcW;
        let targetH = srcH;
        const aspect = srcW / srcH;

        if (resolution === "720p") {
          targetW = 1280;
          targetH = Math.round(1280 / aspect);
        } else if (resolution === "1080p") {
          targetW = 1920;
          targetH = Math.round(1920 / aspect);
        } else if (resolution === "2160p") {
          targetW = 3840;
          targetH = Math.round(3840 / aspect);
        } else if (resolution === "custom_height" && customHeight > 0) {
          targetH = customHeight;
          targetW = Math.round(customHeight * aspect);
        }

        // Establish output size
        canvas.width = targetW;
        canvas.height = targetH;

        // Ensure white backdrop for JPEG/BMP output to avoid black regions on transparency
        if (format === "image/jpeg" || format === "image/bmp") {
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, targetW, targetH);
        }

        // Draw cropped portion from source image scaled to size
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);

        // 3. Watermark handling if watermark element is loaded
        if (watermarkImg) {
          // calculate watermark width relative to canvas size
          const wPercent = watermarkSize / 100;
          const wtWidth = targetW * wPercent;
          // preserve watermark original aspect ratio
          const wtAspect = watermarkImg.naturalWidth / watermarkImg.naturalHeight;
          const wtHeight = wtWidth / wtAspect;

          // Padding in pixels (spacing away from borders) Setup 3% padding
          const padding = Math.max(10, targetW * 0.03);
          let wtX = 0;
          let wtY = 0;

          switch (watermarkPosition) {
            case "bottom-right":
              wtX = targetW - wtWidth - padding;
              wtY = targetH - wtHeight - padding;
              break;
            case "bottom-left":
              wtX = padding;
              wtY = targetH - wtHeight - padding;
              break;
            case "top-right":
              wtX = targetW - wtWidth - padding;
              wtY = padding;
              break;
            case "top-left":
              wtX = padding;
              wtY = padding;
              break;
            case "center":
              wtX = (targetW - wtWidth) / 2;
              wtY = (targetH - wtHeight) / 2;
              break;
          }

          // Apply opacity specifically to watermark layer
          ctx.globalAlpha = watermarkAlpha / 100;
          ctx.drawImage(watermarkImg, wtX, wtY, wtWidth, wtHeight);
          ctx.globalAlpha = 1.0; // restore state
        }

        // 4. Generate dynamic output blob applying quality compression or specific Target KB Size restrictions
        let finalBlob: Blob | null = null;
        let finalUrl = "";

        if (useTargetSize && (format === "image/jpeg" || format === "image/webp" || format === "image/avif")) {
          // Bisection search compression pipeline to exactly meet or stay safely under Target Size KB
          let low = 0.05;
          let high = 1.0;
          
          for (let iter = 0; iter < 5; iter++) {
            const mid = (low + high) / 2;
            const currentBlob = await new Promise<Blob | null>((res) => {
              canvas.toBlob((b) => res(b), format, mid);
            });
            if (currentBlob) {
              const kb = currentBlob.size / 1024;
              finalBlob = currentBlob;
              if (kb <= targetSizeKB) {
                low = mid; // attempt better quality
              } else {
                high = mid; // requires stronger compression
              }
            } else {
              break;
            }
          }
        }

        // Fallback default compression output if target size was not requested or bisection failed
        if (!finalBlob) {
          finalBlob = await new Promise<Blob | null>((res) => {
            canvas.toBlob((b) => res(b), format, quality / 100);
          });
        }

        if (finalBlob) {
          finalUrl = URL.createObjectURL(finalBlob);
        } else {
          finalBlob = uploaded.originalFile;
          finalUrl = uploaded.originalUrl;
        }

        // 5. Compute the final custom file name obeying bulk renaming pattern inputs
        let finalName = uploaded.originalFile.name;
        const extension = FORMAT_OPTIONS.find((f) => f.value === format)?.ext ?? ".webp";

        if (renamePattern.trim() !== "") {
          const sanitizedPattern = renamePattern.trim().replace(/\s+/g, "-").toLowerCase();
          finalName = `${sanitizedPattern}-${idx + 1}${extension}`;
        } else {
          // replace original extension with the targeted format extension
          const lastDotIdx = finalName.lastIndexOf(".");
          if (lastDotIdx !== -1) {
            finalName = finalName.substring(0, lastDotIdx) + extension;
          } else {
            finalName = finalName + extension;
          }
        }

        resolve({
          ...uploaded,
          processedUrl: finalUrl,
          processedBlob: finalBlob,
          fileName: finalName,
          dimensions: { width: targetW, height: targetH },
          originalSize: uploaded.originalSize,
          processedSize: finalBlob.size
        });
      };

      img.src = uploaded.originalUrl;
    });
  };

  const reprocessImages = async (currentImages: UploadedImage[]) => {
    setIsProcessingAll(true);
    const reprocessed: UploadedImage[] = [];
    
    for (let i = 0; i < currentImages.length; i++) {
      const outcome = await applyImagePipeline(currentImages[i], i);
      reprocessed.push(outcome);
    }
    
    // Revoke old object URLs first to prevent massive memory leaks
    images.forEach(oldImg => {
      const matchedNew = reprocessed.find(nIn => nIn.id === oldImg.id);
      if (oldImg.processedUrl && oldImg.processedUrl !== oldImg.originalUrl) {
        if (!matchedNew || matchedNew.processedUrl !== oldImg.processedUrl) {
          URL.revokeObjectURL(oldImg.processedUrl);
        }
      }
    });

    setImages(reprocessed);
    setIsProcessingAll(false);
  };

  // Download logic
  const downloadSingleImage = (img: UploadedImage) => {
    const link = document.createElement("a");
    link.href = img.processedUrl;
    link.download = img.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAllIndividual = () => {
    images.forEach((img, idx) => {
      setTimeout(() => {
        downloadSingleImage(img);
      }, idx * 350);
    });
  };

  const downloadBulkZip = async () => {
    if (images.length === 0) return;
    setIsProcessingAll(true);
    
    const zip = new JSZip();
    images.forEach(img => {
      zip.file(img.fileName, img.processedBlob);
    });

    const content = await zip.generateAsync({ type: "blob" });
    const zipName = `images_${resolution}.zip`;

    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = zipName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setIsProcessingAll(false);
  };

  // Aspect ratio presets values mapping
  const aspectPresets = [
    { label: "Free", value: "Free", ratio: null },
    { label: "16:9 HD", value: "16:9", ratio: 16 / 9 },
    { label: "1:1 Square", value: "1:1", ratio: 1 },
    { label: "4:3 Standard", value: "4:3", ratio: 4 / 3 },
    { label: "FB Link", value: "1.91:1", ratio: 1.91 },
    { label: "FB Cover", value: "820:312", ratio: 820 / 312 },
    { label: "IG Story (9:16)", value: "9:16", ratio: 9 / 16 },
    { label: "IG Portrait (4:5)", value: "4:5", ratio: 4 / 5 },
  ];

  // Live cropping interactive handles
  const openCropModal = (img: UploadedImage) => {
    setActiveCropImage(img);
    setCropAspect(img.cropAspectRatio || "Free");
    if (img.cropBox) {
      setCropBoxPercent(img.cropBox);
    } else {
      setCropBoxPercent({ x: 10, y: 10, w: 80, h: 80 });
    }
  };

  const handleApplyCrop = () => {
    if (!activeCropImage) return;

    const updatedImages = images.map(img => {
      if (img.id === activeCropImage.id) {
        return {
          ...img,
          cropBox: cropBoxPercent,
          cropAspectRatio: cropAspect
        };
      }
      return img;
    });

    // Save state and reprocess instantly to trigger preview regeneration
    setImages(updatedImages);
    setActiveCropImage(null);
    reprocessImages(updatedImages);
  };

  // Helper variables for formatting bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = 1;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  return (
    <div className="h-full flex flex-col space-y-6 max-w-7xl mx-auto pb-10 relative">
      
      {/* Header Panel with Brand accents */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[var(--color-jam-card)] border border-[var(--color-jam-border)] rounded-xl p-5 shadow-sm relative overflow-hidden" id="canvas-header">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--color-jam-red)]/5 rounded-full blur-3xl pointer-events-none" />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono uppercase border px-2.5 py-0.5 rounded tracking-widest font-extrabold bg-[var(--color-jam-red)]/10 border-[var(--color-jam-red)]/20 text-[var(--color-jam-red)]">MEDIA HUB</span>
            <div className="flex items-center gap-1.5 text-[9px] bg-green-500/10 border border-green-500/20 px-2.5 py-0.5 rounded text-green-600 dark:text-green-400 font-mono font-bold">
              <ShieldCheck className="w-3 h-3" />
              <span>PRIVACY ACTIVE</span>
            </div>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-jam-strong mt-2 uppercase">IMAGE TOOL</h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button 
            variant="outline" 
            onClick={clearAllImages} 
            disabled={images.length === 0}
            className="text-xs text-jam-muted hover:text-white border-jam-border"
            size="sm"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Clear All
          </Button>
          <Button 
            onClick={() => reprocessImages(images)} 
            disabled={images.length === 0 || isProcessingAll}
            className="text-xs bg-jam-accent text-white hover:bg-jam-accent-strong"
            size="sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isProcessingAll ? "animate-spin" : ""}`} /> Apply Settings
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left column: Layout Config Controls */}
        <div className="lg:col-span-4 space-y-5">
          
          {/* Section 1: Output Format & Dimensions */}
          <Card className="border-jam-border bg-jam-bg">
            <CardHeader className="pb-3 border-b border-jam-border p-4">
              <CardTitle className="text-xs uppercase tracking-widest font-mono text-white flex items-center gap-2">
                <Compass className="w-3.5 h-3.5 text-jam-accent" /> EXPORT SPECIFICATIONS
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {/* Resolution selection */}
              <div>
                <label className="text-[10px] text-jam-muted font-mono uppercase tracking-wider mb-1.5 block">Preset Resolution</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: "720p HD", value: "720p" },
                    { label: "1080p FHD", value: "1080p" },
                    { label: "2160p 4K", value: "2160p" },
                    { label: "Original aspect", value: "original" },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setResolution(opt.value as any)}
                      className={`py-1.5 px-2 text-left text-xs rounded border transition-all ${resolution === opt.value ? "bg-jam-accent/10 text-white font-bold border-jam-accent" : "bg-jam-surface text-jam-muted border-jam-border hover:text-white"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                
                {/* Custom height choice */}
                <div className="mt-2.5">
                  <button 
                    onClick={() => setResolution("custom_height")}
                    className={`w-full py-1.5 px-3 text-left text-xs rounded border transition-all flex items-center justify-between ${resolution === "custom_height" ? "bg-jam-accent/10 text-white font-bold border-jam-accent" : "bg-jam-surface text-jam-muted border-jam-border hover:text-white"}`}
                  >
                    <span>Custom height scale</span>
                    {resolution === "custom_height" && <span className="text-jam-accent font-mono text-[9px] uppercase font-bold">Active</span>}
                  </button>
                  {resolution === "custom_height" && (
                    <div className="mt-1.5 animate-in slide-in-from-top-1 duration-150">
                      <Input
                        type="number"
                        placeholder="Height in px (e.g. 500)"
                        value={customHeight || ""}
                        onChange={(e) => setCustomHeight(parseInt(e.target.value) || 0)}
                        className="bg-jam-surface border-jam-border text-xs h-8 text-white focus:ring-jam-accent"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Output format drop selections */}
              <div>
                <label className="text-[10px] text-jam-muted font-mono uppercase tracking-wider mb-1.5 block">File Format</label>
                <div className="grid grid-cols-3 gap-1 bg-jam-surface p-1 rounded border border-jam-border">
                  {FORMAT_OPTIONS.map(opt => {
                    const available = !supportedFormats || supportedFormats.has(opt.value);
                    return (
                      <button
                        key={opt.value}
                        title={available ? `${opt.label} — ${opt.hint}` : `${opt.label} — not supported by this browser`}
                        onClick={() => available && setFormat(opt.value as FileFormat)}
                        disabled={!available}
                        className={`py-1 text-[10px] uppercase font-mono rounded transition-colors ${
                          format === opt.value
                            ? "bg-jam-accent text-white font-bold"
                            : available
                              ? "text-jam-muted hover:text-white"
                              : "text-jam-faint/40 line-through cursor-not-allowed"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {supportedFormats && (!supportedFormats.has("image/avif") || !supportedFormats.has("image/bmp")) && (
                  <p className="text-[9px] text-jam-faint mt-1 leading-tight font-serif">
                    AVIF/BMP encoding is browser-dependent — unavailable options are disabled here. WebP is the recommended web/CMS format.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Quality Compression & Target KB constraints */}
          <Card className="border-jam-border bg-jam-bg">
            <CardHeader className="pb-3 border-b border-jam-border p-4">
              <CardTitle className="text-xs uppercase tracking-widest font-mono text-white flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-jam-accent" /> COMPRESSION CONTROL
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              
              {/* Option to toggle target KB mode */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-jam-surface border border-jam-border">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-white font-bold uppercase font-sans tracking-wide">Target Size Limit</span>
                  <span className="text-[9px] text-jam-muted font-mono leading-none">Automate compression bisection</span>
                </div>
                <input 
                  type="checkbox" 
                  checked={useTargetSize}
                  onChange={(e) => setUseTargetSize(e.target.checked)}
                  className="w-4 h-4 rounded border-jam-border text-jam-accent focus:ring-jam-accent bg-jam-card cursor-pointer"
                />
              </div>

              {useTargetSize ? (
                <div className="space-y-1.5 animate-in fade-in duration-200">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] text-jam-muted font-mono uppercase tracking-wider">Maximum File Size</label>
                    <span className="text-xs font-mono font-bold text-white bg-jam-accent/10 text-jam-accent px-2 py-0.5 rounded border border-jam-accent/20">{targetSizeKB} KB</span>
                  </div>
                  <Input
                    type="number"
                    min={10}
                    max={5000}
                    value={targetSizeKB}
                    onChange={(e) => setTargetSizeKB(Math.max(10, parseInt(e.target.value) || 10))}
                    className="bg-jam-surface border-jam-border text-xs h-8 text-white focus:ring-jam-accent"
                  />
                  <p className="text-[9px] text-jam-muted leading-tight font-serif mt-1">If transparent inputs (PNGs) are exported as JPEG or BMP, the background is filled white to avoid black canvas regions.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-[10px] text-jam-muted uppercase tracking-wider">Default Quality</span>
                    <span className="text-white font-bold">{quality}%</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={quality}
                    onChange={(e) => setQuality(parseInt(e.target.value))}
                    className="w-full accent-jam-accent h-1.5 bg-jam-card rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[8px] font-mono text-jam-faint">
                    <span>1% MAX COMPRESSION</span>
                    <span>100% MAXIMUM SIZE</span>
                  </div>
                </div>
              )}

              {/* Advanced Bulk renaming parameters */}
              <div className="pt-3 border-t border-jam-border">
                <label className="text-[10px] text-jam-muted font-mono uppercase tracking-wider mb-1 block">Bulk Rename Pattern</label>
                <Input
                  type="text"
                  placeholder="e.g. pixel-8a-review-shoot"
                  value={renamePattern}
                  onChange={(e) => setRenamePattern(e.target.value)}
                  className="bg-jam-surface border-jam-border text-xs h-8 text-white focus:ring-jam-accent"
                />
                <p className="text-[9px] text-jam-faint mt-1">Produces: <code className="text-jam-muted font-mono">pixel-8a-review-shoot-1.webp</code>, etc.</p>
              </div>

            </CardContent>
          </Card>

          {/* Section 3: Watermark Application config */}
          <Card className="border-jam-border bg-jam-bg">
            <CardHeader className="pb-3 border-b border-jam-border p-4">
              <CardTitle className="text-xs uppercase tracking-widest font-mono text-white flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-jam-accent" /> BRANDED WATERMARK
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-white block">Overlay Signature Watermark</span>
                  <span className="text-[9px] text-jam-muted font-mono">Accepts PNG / SVG with alpha channels</span>
                </div>
                {watermarkImg ? (
                  <span className="text-[8px] font-mono font-bold bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded">
                    WATERMARK ACTIVE
                  </span>
                ) : (
                  <span className="text-[8px] font-mono text-jam-muted bg-jam-surface border border-jam-border px-2 py-0.5 rounded">
                    DISABLED
                  </span>
                )}
              </div>

              {!watermarkImg ? (
                <div className="flex items-center justify-center border-2 border-dashed border-jam-border rounded-lg p-4 hover:border-jam-accent/40 transition-colors bg-jam-surface relative cursor-pointer group">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleWatermarkUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <div className="text-center">
                    <Upload className="w-5 h-5 mx-auto text-jam-muted group-hover:text-jam-accent transition-colors" />
                    <span className="text-[10px] text-jam-muted font-mono mt-1.5 block uppercase">Upload branding mark</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between p-1.5 bg-jam-surface border border-jam-border rounded">
                    <span className="text-[10px] font-mono text-jam-strong truncate max-w-[150px]" title={watermarkFile?.name}>
                      {watermarkFile?.name || "Uploaded watermark"}
                    </span>
                    <Button 
                      onClick={removeWatermark} 
                      variant="ghost" 
                      className="h-6 w-6 p-0 text-jam-muted hover:text-white hover:bg-white/5 opacity-80"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {/* Watermark placement picker */}
                  <div>
                    <label className="text-[10px] text-jam-muted font-mono uppercase tracking-wider mb-1 block">Signature Placement</label>
                    <div className="grid grid-cols-5 gap-1 bg-jam-surface p-1 rounded border border-jam-border">
                      {[
                        { label: "TL", value: "top-left" },
                        { label: "TR", value: "top-right" },
                        { label: "CTR", value: "center" },
                        { label: "BL", value: "bottom-left" },
                        { label: "BR", value: "bottom-right" },
                      ].map(pos => (
                        <button
                          key={pos.value}
                          onClick={() => setWatermarkPosition(pos.value as WatermarkPosition)}
                          className={`py-1 text-[9px] uppercase font-mono rounded transition-colors ${watermarkPosition === pos.value ? "bg-jam-accent text-white font-bold" : "text-jam-muted hover:text-white"}`}
                          title={pos.value}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Watermark size slider */}
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-[10px] font-mono">
                        <span className="text-jam-muted uppercase tracking-wider">Watermark Scale</span>
                        <span className="text-white font-bold">{watermarkSize}%</span>
                      </div>
                      <input
                        type="range"
                        min={5}
                        max={50}
                        value={watermarkSize}
                        onChange={(e) => setWatermarkSize(parseInt(e.target.value))}
                        className="w-full accent-jam-accent h-1 bg-jam-card rounded-lg cursor-pointer"
                      />
                    </div>
                    
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-[10px] font-mono">
                        <span className="text-jam-muted uppercase tracking-wider">Watermark Opacity</span>
                        <span className="text-white font-bold">{watermarkAlpha}%</span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={watermarkAlpha}
                        onChange={(e) => setWatermarkAlpha(parseInt(e.target.value))}
                        className="w-full accent-jam-accent h-1 bg-jam-card rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Watermark Live preview thumbnail */}
                  <div className="p-3 bg-jam-surface border border-jam-border rounded flex justify-center relative select-none">
                    <span className="absolute top-1 left-1 text-[8px] font-mono text-jam-faint uppercase">Placement Layout</span>
                    <div className="w-24 h-16 bg-jam-border rounded relative border border-white/5 shadow-inner">
                      {/* Simulating placement inside thumbnail frame */}
                      <div 
                        className={`absolute w-4 h-4 bg-jam-accent/40 border border-jam-accent/60 rounded-sm flex items-center justify-center text-[7px] text-white font-mono font-bold transition-all duration-300`}
                        style={{
                          left: watermarkPosition === "top-left" || watermarkPosition === "bottom-left" ? "4px" : watermarkPosition === "center" ? "calc(50% - 8px)" : "auto",
                          right: watermarkPosition === "top-right" || watermarkPosition === "bottom-right" ? "4px" : "auto",
                          top: watermarkPosition === "top-left" || watermarkPosition === "top-right" ? "4px" : watermarkPosition === "center" ? "calc(50% - 8px)" : "auto",
                          bottom: watermarkPosition === "bottom-left" || watermarkPosition === "bottom-right" ? "4px" : "auto",
                        }}
                      >
                        W
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

        </div>

        {/* Right column: Image Uploader, Queue view, and Card Grid */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Main Action Uploader Drop Area */}
          <div 
            ref={dragAreaRef}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="border-2 border-dashed border-jam-border hover:border-jam-accent/40 hover:bg-jam-accent/[0.01] rounded-xl p-10 text-center transition-all duration-200 bg-jam-bg shadow-lg relative group cursor-pointer"
          >
            <input 
              type="file" 
              multiple 
              accept="image/jpeg,image/png,image/webp" 
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="space-y-4 pointer-events-none relative z-0">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-jam-accent/10 to-jam-accent-strong/10 group-hover:from-jam-accent/15 group-hover:to-jam-accent-strong/20 border border-jam-accent/20 flex items-center justify-center mx-auto transition-colors shadow">
                <Upload className="w-6 h-6 text-jam-accent animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans">Batch Import Images</h3>
                <p className="text-xs text-jam-muted mt-1.5 max-w-md mx-auto leading-relaxed">Drag-and-drop multiple JPG, PNG, or WEBP photos, or <span className="text-jam-accent underline cursor-pointer">browse your files</span>. All processing runs 100% locally in your browser — nothing is uploaded, no AI, no tokens. Works fully offline.</p>
              </div>
              <div className="flex items-center justify-center gap-4 text-[10px] font-mono text-jam-faint">
                <span>JPG / JPEG</span>
                <span>•</span>
                <span>PNG</span>
                <span>•</span>
                <span>WEBP SUPPORT</span>
                <span>•</span>
                <span>100% LOCAL</span>
              </div>
            </div>
          </div>

          {/* Active Outputs Batch Operations bar */}
          {images.length > 0 && (
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-jam-bg border border-jam-border rounded-xl gap-4 shadow-md">
              <div>
                <span className="text-xs font-mono text-jam-strong uppercase tracking-wider block">Processed Status Log</span>
                <span className="text-xs font-extrabold text-white mt-1 block">
                  <span className="text-jam-accent">{images.length}</span> {images.length === 1 ? "Image is" : "Images are"} formatted and ready for CMS export.
                </span>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                <Button 
                  onClick={downloadAllIndividual}
                  variant="outline" 
                  size="sm" 
                  className="font-mono text-[10px] uppercase border-jam-border hover:bg-jam-surface text-white"
                >
                  <FolderDown className="w-3.5 h-3.5 mr-1.5" /> Download Files
                </Button>
                <Button 
                  onClick={downloadBulkZip}
                  size="sm" 
                  className="bg-jam-accent hover:bg-jam-accent-strong text-white font-mono text-[10px] uppercase shadow-lg"
                >
                  <FileArchive className="w-3.5 h-3.5 mr-1.5" /> Export as .ZIP
                </Button>
              </div>
            </div>
          )}

          {/* Dynamic Rendered Grid list */}
          {images.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {images.map((img) => {
                const ratioReduction = img.processedSize < img.originalSize 
                  ? Math.round((1 - (img.processedSize / img.originalSize)) * 100) 
                  : 0;

                return (
                  <Card key={img.id} className="border-jam-border bg-jam-bg overflow-hidden flex flex-col group/card hover:border-jam-accent/40 transition-colors shadow">
                    
                    {/* Upper preview area */}
                    <div className="h-48 bg-jam-bg relative flex items-center justify-center overflow-hidden border-b border-jam-border select-none">
                      <img 
                        src={img.processedUrl} 
                        alt="Export Preview" 
                        referrerPolicy="no-referrer"
                        className="max-w-full max-h-full object-contain"
                      />
                      
                      {/* Image dimension tags */}
                      <span className="absolute bottom-2 left-2 text-[9px] font-mono bg-jam-bg/80 border border-white/5 backdrop-blur px-2 py-0.5 rounded text-jam-muted z-10">
                        {img.dimensions.width > 0 ? `${img.dimensions.width} x ${img.dimensions.height}` : "Loading Spec..."}
                      </span>

                      {/* Compression indicator badge */}
                      {ratioReduction > 0 && (
                        <span className="absolute top-2 right-2 text-[8px] font-mono font-bold bg-jam-accent/15 text-jam-accent border border-jam-accent/20 px-2.5 py-0.5 rounded-full backdrop-blur">
                          -{ratioReduction}% SAVED
                        </span>
                      )}

                      {/* Edit overlays triggers */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 z-10 pointer-events-auto">
                        <Button
                          onClick={() => openCropModal(img)}
                          size="sm"
                          variant="secondary"
                          className="text-xs bg-jam-surface text-white hover:bg-jam-accent hover:text-white"
                        >
                          <Crop className="w-3.5 h-3.5 mr-1.5" /> Crop / Aspect
                        </Button>
                        <Button 
                          onClick={() => downloadSingleImage(img)}
                          size="sm" 
                          className="text-xs bg-jam-accent text-white hover:bg-jam-accent-strong"
                        >
                          <Download className="w-3.5 h-3.5 mr-1.5" /> Download
                        </Button>
                      </div>
                    </div>

                    {/* Metadata summary info card sections */}
                    <CardContent className="p-3 space-y-2 flex-grow flex flex-col justify-between">
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold font-sans text-white truncate leading-relaxed" title={img.fileName}>
                          {img.fileName}
                        </h4>
                        <div className="flex justify-between items-center text-[10px] text-jam-muted font-mono mt-1">
                          <span>Original size:</span>
                          <span>{formatBytes(img.originalSize)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-mono text-jam-muted mt-0.5 font-bold">
                          <span>Export size:</span>
                          <span className={img.processedSize <= targetSizeKB * 1024 && useTargetSize ? "text-green-400 font-bold" : ""}>
                            {formatBytes(img.processedSize)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-jam-border gap-2">
                        {img.cropBox ? (
                          <div className="flex items-center gap-1 text-[9px] font-mono text-jam-accent bg-jam-accent/10 border border-jam-accent/20 px-2 py-0.5 rounded">
                            <Crop className="w-3 h-3" />
                            <span>CROPPED ({img.cropAspectRatio})</span>
                          </div>
                        ) : (
                          <span className="text-[9px] text-jam-faint font-mono uppercase tracking-wide">NO RECENT CROPPING</span>
                        )}

                        <Button 
                          onClick={() => deleteImage(img.id)}
                          variant="ghost" 
                          size="icon" 
                          aria-label="Remove Image"
                          className="h-7 w-7 text-jam-muted hover:text-red-500 hover:bg-red-500/10 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>

                    </CardContent>

                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="border border-dashed border-jam-border bg-jam-bg rounded-xl p-12 text-center shadow-inner">
              <div className="w-12 h-12 bg-jam-surface border border-jam-border rounded-xl flex items-center justify-center mx-auto text-jam-muted mb-4">
                <ImageIcon className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans">No Images Uploaded</h3>
              <p className="text-xs text-jam-muted mt-1.5 max-w-sm mx-auto leading-relaxed">Import high-quality photographs, define output formats, upload brand watermarks, and export instantly — WebP-first and ready for your CMS.</p>
            </div>
          )}

        </div>

      </div>

      {/* Values footer — the tool is deliberately token-free & offline */}
      <div className="pt-5 mt-1 flex flex-col items-center gap-1.5 text-center select-none border-t border-jam-border/70">
        <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-jam-muted leading-relaxed">
          <span className="text-jam-accent font-bold">READY, NOT RELIANT</span> — USE AI WHERE IT ADDS JUDGMENT, TOOLING WHERE IT ADDS NONE
        </p>
        <p className="text-[9px] font-mono text-jam-faint">
          Every conversion runs 100% locally in this browser — zero tokens · zero uploads · works fully offline
        </p>
      </div>

      {/* Interactive 100% Client-Side Crop Modal */}
      {activeCropImage && (
        <CropModal
          image={activeCropImage}
          initialBox={cropBoxPercent}
          initialAspect={cropAspect}
          presets={aspectPresets}
          onClose={() => setActiveCropImage(null)}
          onApply={handleApplyCrop}
          setCropBoxPercent={setCropBoxPercent}
          setCropAspect={setCropAspect}
        />
      )}

    </div>
  );
}

// Separate internal component for the modal to maintain crisp, clean react state rendering
interface CropModalProps {
  image: UploadedImage;
  initialBox: { x: number; y: number; w: number; h: number };
  initialAspect: string;
  presets: any[];
  onClose: () => void;
  onApply: () => void;
  setCropBoxPercent: (box: { x: number; y: number; w: number; h: number }) => void;
  setCropAspect: (aspect: string) => void;
}

function CropModal({
  image,
  initialBox,
  initialAspect,
  presets,
  onClose,
  onApply,
  setCropBoxPercent,
  setCropAspect,
}: CropModalProps) {
  const [aspect, setAspect] = useState<string>(initialAspect);
  const [box, setBox] = useState(initialBox);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Apply default presets on dynamic click
  const selectPreset = (presetName: string, ratio: number | null) => {
    setAspect(presetName);
    setCropAspect(presetName);

    if (ratio) {
      // Fit aspect ratios based on maximum center alignment container
      let w = 80;
      let h = 80;
      const containerAspect = 1.33; // Mocking estimation, normally 4/3

      if (ratio > containerAspect) {
        h = w / ratio;
      } else {
        w = h * ratio;
      }

      const x = (100 - w) / 2;
      const y = (100 - h) / 2;
      setBox({ x, y, w, h });
      setCropBoxPercent({ x, y, w, h });
    } else {
      // Free form
      setBox({ x: 10, y: 10, w: 80, h: 80 });
      setCropBoxPercent({ x: 10, y: 10, w: 80, h: 80 });
    }
  };

  // Implement simple mouse dragging handles for highly precise, interactive crops
  const handleDragBoxStart = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const startX = mouseDownEvent.clientX;
    const startY = mouseDownEvent.clientY;
    const startBoxX = box.x;
    const startBoxY = box.y;

    const containerRect = container.getBoundingClientRect();

    const handleMouseMove = (mouseMoveEvent: MouseEvent) => {
      const deltaXPercent = ((mouseMoveEvent.clientX - startX) / containerRect.width) * 100;
      const deltaYPercent = ((mouseMoveEvent.clientY - startY) / containerRect.height) * 100;

      let newX = Math.max(0, Math.min(100 - box.w, startBoxX + deltaXPercent));
      let newY = Math.max(0, Math.min(100 - box.h, startBoxY + deltaYPercent));

      const updatedBox = { ...box, x: newX, y: newY };
      setBox(updatedBox);
      setCropBoxPercent(updatedBox);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Resize anchors dragging logic
  const handleResizeStart = (mouseDownEvent: React.MouseEvent, handle: "tl" | "tr" | "bl" | "br") => {
    mouseDownEvent.preventDefault();
    mouseDownEvent.stopPropagation();
    
    const container = containerRef.current;
    if (!container) return;

    const startX = mouseDownEvent.clientX;
    const startY = mouseDownEvent.clientY;
    const startBox = { ...box };

    const containerRect = container.getBoundingClientRect();
    const activePreset = presets.find(p => p.value === aspect);
    const ratio = activePreset?.ratio || null;

    const handleMouseMove = (mouseMoveEvent: MouseEvent) => {
      const deltaXPercent = ((mouseMoveEvent.clientX - startX) / containerRect.width) * 100;
      const deltaYPercent = ((mouseMoveEvent.clientY - startY) / containerRect.height) * 100;

      let newBox = { ...startBox };

      if (handle === "br") {
        newBox.w = Math.max(10, Math.min(100 - startBox.x, startBox.w + deltaXPercent));
        if (ratio) {
          // respect aspect ratio bound mapping
          newBox.h = newBox.w / ratio;
        } else {
          newBox.h = Math.max(10, Math.min(100 - startBox.y, startBox.h + deltaYPercent));
        }
      } else if (handle === "bl") {
        const potentialW = startBox.w - deltaXPercent;
        if (potentialW >= 10 && startBox.x + deltaXPercent >= 0) {
          newBox.w = potentialW;
          newBox.x = startBox.x + deltaXPercent;
          if (ratio) {
            newBox.h = newBox.w / ratio;
          } else {
            newBox.h = Math.max(10, Math.min(100 - startBox.y, startBox.h + deltaYPercent));
          }
        }
      } else if (handle === "tr") {
        newBox.w = Math.max(10, Math.min(100 - startBox.x, startBox.w + deltaXPercent));
        const potentialH = startBox.h - deltaYPercent;
        if (potentialH >= 10 && startBox.y + deltaYPercent >= 0) {
          newBox.h = potentialH;
          newBox.y = startBox.y + deltaYPercent;
          if (ratio) {
            newBox.w = newBox.h * ratio;
          }
        }
      } else if (handle === "tl") {
        const potentialW = startBox.w - deltaXPercent;
        const potentialH = startBox.h - deltaYPercent;
        if (potentialW >= 10 && potentialH >= 10 && startBox.x + deltaXPercent >= 0 && startBox.y + deltaYPercent >= 0) {
          newBox.w = potentialW;
          newBox.x = startBox.x + deltaXPercent;
          newBox.h = potentialH;
          newBox.y = startBox.y + deltaYPercent;
          if (ratio) {
            newBox.h = newBox.w / ratio;
          }
        }
      }

      // Check boundaries constraints
      if (newBox.x + newBox.w <= 100 && newBox.y + newBox.h <= 100) {
        setBox(newBox);
        setCropBoxPercent(newBox);
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      
      <Card className="relative w-full max-w-4xl bg-jam-surface border-jam-border shadow-2xl animate-in zoom-in duration-150 flex flex-col max-h-[90vh]">
        
        {/* Modal headers */}
        <CardHeader className="border-b border-jam-border p-4 shrink-0 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-md text-white flex items-center gap-1.5 font-bold uppercase tracking-wider">
              <Crop className="w-4 h-4 text-jam-accent" /> Edit Crop Boundaries
            </CardTitle>
            <CardDescription className="text-[10px] font-mono uppercase tracking-widest text-jam-muted mt-0.5">// Precise pixel aspect overlay</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-jam-muted hover:text-white hover:bg-white/5">
            <X className="w-5 h-5" />
          </Button>
        </CardHeader>

        {/* Modal Main body */}
        <div className="p-4 overflow-y-auto flex-grow flex flex-col md:flex-row gap-5">
          
          {/* Sizing frame canvas target on left */}
          <div className="flex-1 bg-jam-bg rounded-lg border border-jam-border flex items-center justify-center relative select-none overflow-hidden min-h-[300px]">
            <div 
              ref={containerRef}
              className="relative w-full max-w-md aspect-video md:aspect-auto md:h-[40vh] flex items-center justify-center"
            >
              {/* Reference cropping picture */}
              <img 
                ref={imageRef}
                src={image.originalUrl} 
                alt="Source Crop" 
                referrerPolicy="no-referrer"
                className="max-w-full max-h-full object-contain pointer-events-none"
              />

              {/* Mask overlay container - covers active scale */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-full h-full max-w-full max-h-full pointer-events-auto">
                  
                  {/* Backdrop mask filter */}
                  <div className="absolute inset-0 bg-black/65 pointer-events-none" />

                  {/* Highlights Crop Box frame utilizing double border shadow trick */}
                  <div
                    onMouseDown={handleDragBoxStart}
                    style={{
                      left: `${box.x}%`,
                      top: `${box.y}%`,
                      width: `${box.w}%`,
                      height: `${box.h}%`,
                      position: "absolute"
                    }}
                    className="border-2 border-white cursor-move shadow-[0_0_0_10000px_rgba(0,0,0,0.65)] hover:border-jam-accent transition-colors"
                  >
                    {/* Grid Guide Rule of Thirds lines */}
                    <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-25">
                      <div className="border-r border-b border-white border-dashed" />
                      <div className="border-r border-b border-white border-dashed" />
                      <div className="border-b border-white border-dashed" />
                      <div className="border-r border-b border-white border-dashed" />
                      <div className="border-r border-b border-white border-dashed" />
                      <div className="border-b border-white border-dashed" />
                      <div className="border-r border-white border-dashed" />
                      <div className="border-r border-white border-dashed" />
                      <div className="pointer-events-none" />
                    </div>

                    {/* Highly tactile drag handles markers */}
                    {/* Top Left */}
                    <div 
                      onMouseDown={(e) => handleResizeStart(e, "tl")}
                      className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-black cursor-nwse-resize rounded"
                    />
                    {/* Top Right */}
                    <div 
                      onMouseDown={(e) => handleResizeStart(e, "tr")}
                      className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-black cursor-nesw-resize rounded"
                    />
                    {/* Bottom Left */}
                    <div 
                      onMouseDown={(e) => handleResizeStart(e, "bl")}
                      className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-black cursor-nesw-resize rounded"
                    />
                    {/* Bottom Right */}
                    <div 
                      onMouseDown={(e) => handleResizeStart(e, "br")}
                      className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-black cursor-nwse-resize rounded"
                    />

                    {/* Bottom centering badge showing current coordinates */}
                    <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-black/80 px-2 py-0.5 rounded text-[8px] font-mono text-jam-muted border border-white/5 pointer-events-none whitespace-nowrap">
                      {Math.round(box.w)}% w x {Math.round(box.h)}% h
                    </div>
                  </div>

                </div>
              </div>

            </div>
          </div>

          {/* Configuration menu panel on right */}
          <div className="w-full md:w-[240px] shrink-0 flex flex-col justify-between gap-4">
            <div className="space-y-4">
              <label className="text-[10px] text-jam-muted font-mono uppercase tracking-wider block">Aspect Presets</label>
              
              <div className="grid grid-cols-2 gap-1.5 max-h-[250px] overflow-y-auto no-scrollbar pr-1">
                {presets.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => selectPreset(preset.value, preset.ratio)}
                    className={`py-2 px-2.5 text-xs text-left rounded border transition-all ${aspect === preset.value ? "bg-jam-accent/10 text-white font-bold border-jam-accent" : "bg-jam-surface text-jam-muted border-jam-border hover:text-white"}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="bg-jam-surface border border-jam-border rounded-lg p-3 space-y-1.5">
                <span className="text-[10px] font-mono text-jam-accent uppercase font-bold flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Grid Guides Active
                </span>
                <p className="text-[9px] text-jam-muted leading-relaxed font-serif">Utilize the embedded 3x3 overlay grids based on focal rule-of-thirds techniques to perfectly capture highlight objects in your review products.</p>
              </div>
            </div>

            <div className="flex gap-2 pt-3 border-t border-jam-border">
              <Button onClick={onClose} variant="outline" className="flex-1 text-xs border-jam-border text-jam-muted hover:text-white">
                Cancel
              </Button>
              <Button onClick={onApply} className="flex-1 text-xs bg-jam-accent hover:bg-jam-accent-strong text-white">
                Apply Crop
              </Button>
            </div>
          </div>

        </div>

      </Card>
    </div>
  );
}
