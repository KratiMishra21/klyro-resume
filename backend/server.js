import express from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import mammoth from "mammoth";
import { HfInference } from "@huggingface/inference";
import cors from "cors";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// For CommonJS modules in ES6
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Correct __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CORS must come BEFORE other middleware
app.use(cors({
  origin: ["https://klyro-resume.vercel.app", "http://localhost:3000", "http://localhost:5173"],
  methods: ["POST", "GET", "OPTIONS"],
  credentials: true,
}));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads");
try {
  await fs.mkdir(uploadsDir, { recursive: true });
} catch (err) {
  console.log("Uploads directory already exists or error:", err.message);
}

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  },
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword"
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF and DOCX allowed."));
    }
  }
});

// Hugging Face API init
const hf = new HfInference(process.env.HF_API_KEY);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

// ------------------ RESUME REVIEW ------------------
app.post("/upload", upload.single("resume"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const uploadPath = path.join(__dirname, "uploads", req.file.filename);

  try {
    const dataBuffer = await fs.readFile(uploadPath);
    let resumeText = "";

    if (req.file.mimetype === "application/pdf") {
      const pdfData = await pdfParse(dataBuffer);
      resumeText = pdfData.text;
    } else if (
      req.file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      req.file.mimetype === "application/msword"
    ) {
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      resumeText = result.value;
    } else {
      return res.status(400).json({ error: "Unsupported file type. Upload a PDF or DOCX." });
    }

    if (!resumeText.trim()) {
      return res.status(400).json({ error: "Could not extract text from resume." });
    }

    const result = await hf.chatCompletion({
      model: "mistralai/Mistral-7B-Instruct-v0.3",
      messages: [
        {
          role: "system",
          content:
            "You are an expert resume reviewer. Provide structured, professional, and constructive feedback. Format the response in clean, well-structured Markdown with clear section headings, bullet points, and bold highlights where needed.",
        },
        {
          role: "user",
          content: `Please review this resume for:
1. Overall Impression
2. Strengths
3. Areas for Improvement
4. ATS Compatibility Score (0–100)
5. Suggested Action Items

Resume:
${resumeText}`,
        },
      ],
      max_tokens: 800,
    });

    const outputText = result?.choices?.[0]?.message?.content || null;

    if (!outputText) {
      throw new Error("No valid response from Hugging Face");
    }

    res.status(200).json({ analysis: outputText });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ 
      error: "Server error while analyzing resume.",
      details: error.message 
    });
  } finally {
    try {
      await fs.unlink(uploadPath);
    } catch (err) {
      console.error("Error deleting temp file:", err);
    }
  }
});

// ------------------ KEYWORD MATCH (NEW FEATURE) ------------------
app.post("/api/keyword-match", upload.single("resume"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const uploadPath = path.join(__dirname, "uploads", req.file.filename);

  try {
    const dataBuffer = await fs.readFile(uploadPath);
    let resumeText = "";

    if (req.file.mimetype === "application/pdf") {
      const pdfData = await pdfParse(dataBuffer);
      resumeText = pdfData.text;
    } else if (
      req.file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      req.file.mimetype === "application/msword"
    ) {
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      resumeText = result.value;
    }

    const jobDescription = req.body.jobDescription || "";
    
    if (!jobDescription.trim()) {
      return res.status(400).json({ error: "Job description is required" });
    }

    const jobWords = jobDescription.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const resumeWords = resumeText.toLowerCase().split(/\W+/);

    const missing = jobWords.filter(w => w && !resumeWords.includes(w));
    const matchScore = jobWords.length
      ? Math.round(((jobWords.length - missing.length) / jobWords.length) * 100)
      : 0;

    res.json({ matchScore, missing: missing.slice(0, 20) }); // Limit to 20 missing words
  } catch (err) {
    console.error("Keyword match error:", err);
    res.status(500).json({ 
      error: "Something went wrong on server",
      details: err.message 
    });
  } finally {
    try {
      await fs.unlink(uploadPath);
    } catch (err) {
      console.error("Error deleting temp file:", err);
    }
  }
});

// Serve static files from frontend & images folder (AFTER API routes)
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/images", express.static(path.join(__dirname, "../images")));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ 
    error: "Internal server error",
    message: err.message 
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
