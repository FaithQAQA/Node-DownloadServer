// googleDriveUtil.js
const axios = require('axios');
const fs = require('fs-extra');
const cheerio = require('cheerio');

async function downloadFromGoogleDrive(fileId, destinationPath) {
  const baseUrl = 'https://drive.google.com/uc?export=download';

  // First request
  const res = await axios.get(`${baseUrl}&id=${fileId}`, {
    responseType: 'text',
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  // Try to extract confirm token
  const $ = cheerio.load(res.data);
  const token = $('form input[name="confirm"]').attr('value');

  let downloadUrl;
  let finalResponse;

  if (token) {
    downloadUrl = `${baseUrl}&confirm=${token}&id=${fileId}`;
    finalResponse = await axios.get(downloadUrl, {
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
  } else if (res.headers['content-disposition']) {
    finalResponse = await axios({
      method: 'GET',
      url: `${baseUrl}&id=${fileId}`,
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
  } else {
    throw new Error('Unable to find Google Drive confirmation token.');
  }

  const writer = fs.createWriteStream(destinationPath);
  return new Promise((resolve, reject) => {
    finalResponse.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

module.exports = { downloadFromGoogleDrive };
