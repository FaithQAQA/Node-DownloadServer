const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
const port = 3000;
const axios = require('axios');
const extract = require('extract-zip');
const { exec } = require('child_process');
const fs = require('fs-extra');
const os = require('os');

const path7za = require('7zip-bin').path7za; // ✅ FIXED HERE
const allowedOrigins = [
  'https://file-downloader-tau.vercel.app',
  'http://localhost:4200'
];


let fileTypeFromFile;
(async () => {
  const fileTypeModule = await import('file-type');
  fileTypeFromFile = fileTypeModule.fileTypeFromFile;
})();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Handle preflight requests for all routes
app.options('/{*any}', cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(bodyParser.json());

app.post('/create-folders', (req, res) => {
  const basePath = req.body.basePath;
  if (!basePath) {
    return res.status(400).json({ error: 'basePath is required' });
  }

  const folders = [
    'Emulators',
    path.join('Switch games', 'Roms'),
    path.join('Switch games', 'Updates'),
    path.join('Switch games', 'Dlc'),
    'WiiGames',
    path.join('Firmware', 'misc')
  ];

  try {
    folders.forEach(folder => {
      const fullPath = path.join(basePath, folder);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    });

    res.json({ success: true, message: 'Folders created successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Error creating folders', details: err.message });
  }
});

app.post('/extract', async (req, res) => {
  const { archivePath, targetDir } = req.body;

  if (!archivePath || !targetDir) {
    return res.status(400).json({ error: 'archivePath and targetDir are required' });
  }

  const resolvedArchivePath = path.resolve(archivePath);
  const resolvedTargetDir = path.resolve(targetDir);

  try {
    if (!await fs.pathExists(resolvedArchivePath)) {
      return res.status(404).json({ error: 'Archive file not found.', path: resolvedArchivePath });
    }

    await fs.ensureDir(resolvedTargetDir);
    await extract(resolvedArchivePath, { dir: resolvedTargetDir });

    res.json({ message: 'Extraction complete.' });
  } catch (err) {
    console.error('Extraction failed:', err);
    res.status(500).json({ error: 'Extraction failed.', details: err.message });
  }
});

app.post('/firmware-download', async (req, res) => {
  const { fileId, filename } = req.body;

  if (!fileId || !filename) {
    return res.status(400).json({ error: 'Missing fileId or filename' });
  }

  try {
    const baseURL = 'https://drive.google.com/uc?export=download';
    const session = axios.create({ withCredentials: true });

    // Step 1: Initial request (may get confirmation warning)
    let initialRes = await session.get(baseURL, {
      params: { id: fileId },
      responseType: 'text'
    });

    let confirmTokenMatch = initialRes.data.match(/confirm=([0-9A-Za-z_]+)&/);
    let confirmToken = confirmTokenMatch ? confirmTokenMatch[1] : null;

    if (!confirmToken) {
      // For small files, direct stream
      const fileStream = await axios.get(baseURL, {
        params: { id: fileId },
        responseType: 'stream'
      });

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return fileStream.data.pipe(res);
    }

    // Step 2: Use confirmation token to get real file
    const downloadRes = await session.get(baseURL, {
      params: { id: fileId, confirm: confirmToken },
      responseType: 'stream'
    });

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    downloadRes.data.pipe(res);

  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Download failed', details: err.message });
  }
});

// Helper to download file from Google Drive with confirm token
async function downloadFromGoogleDrive(fileId, dest) {
  const baseURL = 'https://drive.google.com/uc?export=download';

  const initialRes = await axios.get(baseURL, {
    params: { id: fileId },
    responseType: 'text'
  });

  const tokenMatch = initialRes.data.match(/confirm=([0-9A-Za-z-_]+)&/);
  const confirmToken = tokenMatch ? tokenMatch[1] : null;

  const finalUrl = confirmToken
    ? `${baseURL}&confirm=${confirmToken}&id=${fileId}`
    : `${baseURL}&id=${fileId}`;

  const response = await axios.get(finalUrl, { responseType: 'stream' });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(dest);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

const Seven = require('node-7z');
const sevenBin = require('7zip-bin');
const pathTo7zip = sevenBin.path7za;

app.post('/download-keys', async (req, res) => 
  {
   const typeInfo = await fileTypeFromFile(tempDownloadPath);

  const { url, type, subtype, firmwarePath } = req.body;

  if (!url || !type || !subtype || !firmwarePath) {
    return res.status(400).json({ error: 'Missing required fields (url, type, subtype, firmwarePath)' });
  }

  if (type !== 'tool' || subtype !== 'firmware') {
    return res.status(400).json({ error: 'Invalid type or subtype' });
  }

  let parsedUrl, fileName;
  try {
    parsedUrl = new URL(url.trim());
    fileName = path.basename(parsedUrl.pathname) || 'download.rar';
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const registeredPath = path.join(firmwarePath, 'keys');
  const tempDownloadPath = path.join(os.tmpdir(), fileName);

  try {
    await fs.ensureDir(registeredPath);
    console.log('Download to:', tempDownloadPath);
    console.log('Extract to:', registeredPath);

    // Download
    if (parsedUrl.hostname.includes('drive.google.com')) {
      const idMatch = url.match(/id=([^&]+)/) || url.match(/\/d\/([^\/]+)/);
      const fileId = idMatch?.[1];

      if (!fileId) {
        return res.status(400).json({ error: 'Invalid Google Drive URL - no file ID found.' });
      }

      await downloadFromGoogleDrive(fileId, tempDownloadPath);
    } else {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream'
      });

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(tempDownloadPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    }

    // Detect extension
    let ext = path.extname(tempDownloadPath).toLowerCase();
    if (!ext) {
      const typeInfo = await fileTypeFromFile(tempDownloadPath);
      ext = typeInfo?.ext ? '.' + typeInfo.ext : '';
    }

    console.log('Detected extension:', ext);

    // Extract
    if (ext === '.zip') {
      await extract(tempDownloadPath, { dir: registeredPath });
    } else if (ext === '.rar' || ext === '.7z') {
      await new Promise((resolve, reject) => {
        const stream = Seven.extractFull(tempDownloadPath, registeredPath, {
          $bin: path7za,
          overwrite: 'a'
        });

        stream.on('data', d => console.log('7z output:', d.toString?.() || d));
        stream.on('end', () => {
          console.log('7z extraction complete');
          resolve();
        });
        stream.on('error', reject);
      });
    } else {
      await fs.remove(tempDownloadPath);
      return res.status(400).json({ error: `Unsupported archive format: ${ext}` });
    }

    await fs.remove(tempDownloadPath);

    const extractedFiles = await fs.readdir(registeredPath);
    if (!extractedFiles.length) throw new Error('No files extracted');

    return res.json({ message: `Keys downloaded and extracted (${ext})`, files: extractedFiles });

  } catch (err) {
    console.error('General error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Download failed', details: err.message });
    }
  }
});


app.post('/download-dynamic', async (req, res) => {
  const { url, fileName, basePath, destinationType, title } = req.body;
  if (!url || !fileName || !basePath) {
    return res.status(400).json({ error: 'Missing url, fileName, or basePath' });
  }

  const ext = path.extname(fileName).toLowerCase();
  const tempPath = path.join(os.tmpdir(), fileName);

  let targetDir;

  switch (destinationType) {
    case 'emulator':
      targetDir = path.join(basePath, 'Emulators');
      break;
    case 'firmware':
      targetDir = path.join(basePath, 'Firmware');
      break;
    case 'tool':
      // tool gets its own subfolder inside basePath
      const cleanName = title ? title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30) : 'tool';
      targetDir = path.join(basePath, cleanName);
      break;
    case 'wiigames':
      targetDir = path.join(basePath, 'wiigames');
      break;
    case 'base':
    default:
      targetDir = basePath;
      break;
  }

  try {
    await fs.ensureDir(targetDir);

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    writer.on('finish', async () => {
      try {
        if (ext === '.zip') {
          await extract(tempPath, { dir: targetDir });
          await fs.remove(tempPath);
        } else if (ext === '.7z' || ext === '.rar') {
          const stream = Seven.extractFull(tempPath, targetDir, {
            $bin: pathTo7zip,
            overwrite: 'a'
          });

          stream.on('end', async () => {
            await fs.remove(tempPath);
            return res.json({ message: 'Download and extraction complete.' });
          });

          stream.on('error', async (err) => {
            await fs.remove(tempPath);
            return res.status(500).json({ error: '7z extraction failed.', details: err.message });
          });

          return; // prevent duplicate res
        } else {
          await fs.move(tempPath, path.join(targetDir, fileName));
        }

        return res.json({ message: 'Download complete.' });
      } catch (extractErr) {
        console.error('Extraction error:', extractErr);
        return res.status(500).json({ error: 'Failed to extract or move file.', details: extractErr.message });
      }
    });

    writer.on('error', () => {
      return res.status(500).json({ error: 'Failed to write file stream.' });
    });

  } catch (err) {
    console.error('Download handler error:', err);
    return res.status(500).json({ error: 'Failed to handle download.', details: err.message });
  }
});

app.post('/download-emulator', async (req, res) => {
  const { url, fileName, basePath, type, subtype, firmwarePath } = req.body;

  if (!url || !fileName || !basePath) {
    return res.status(400).json({ error: 'Missing url, fileName, or basePath' });
  }

  try {
    const ext = path.extname(fileName).toLowerCase();
    const emuFolder = path.join(basePath, 'Emulators');
    await fs.ensureDir(emuFolder);

    if (type === 'tool' && subtype === 'firmware') {
      if (!firmwarePath) {
        return res.status(400).json({ error: 'Missing firmwarePath in request body.' });
      }

      const registeredPath = path.join(firmwarePath, 'nand', 'system', 'Contents', 'registered');
      await fs.ensureDir(registeredPath);

      const tempDownloadPath = path.join(os.tmpdir(), fileName);

      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream'
      });

      const writer = fs.createWriteStream(tempDownloadPath);
      response.data.pipe(writer);

      writer.on('finish', async () => {
        if (ext === '.zip') {
          await extract(tempDownloadPath, { dir: registeredPath });
          await fs.remove(tempDownloadPath);
        } else if (ext === '.7z') {
          exec(`7z x "${tempDownloadPath}" -o"${registeredPath}" -y`, async (err) => {
            if (err) {
              console.error('7z extraction failed:', err);
              return res.status(500).send('7z extraction failed');
            }
            await fs.remove(tempDownloadPath);
            return res.json({ message: 'Firmware downloaded and installed.' });
          });
          return;
        } else {
          await fs.move(tempDownloadPath, path.join(registeredPath, fileName));
        }

        return res.json({ message: 'Firmware downloaded and installed.' });
      });

      writer.on('error', () => {
        return res.status(500).send('Failed to download firmware.');
      });

      return;
    }

    // Default emulator download logic
    const filePath = path.join(emuFolder, fileName);

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on('finish', async () => {
      if (ext === '.zip') {
        await extract(filePath, { dir: emuFolder });
        await fs.remove(filePath);
      } else if (ext === '.7z') {
        exec(`7z x "${filePath}" -o"${emuFolder}" -y`, async (err) => {
          if (err) {
            console.error('7z extraction failed:', err);
            return res.status(500).send('7z extraction failed');
          }
          await fs.remove(filePath);
        });
      }
      return res.json({ message: 'Downloaded and extracted.' });
    });

    writer.on('error', () => {
      return res.status(500).send('Failed to download emulator.');
    });

  } catch (err) {
    console.error(err);
    return res.status(500).send('Error occurred.');
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
