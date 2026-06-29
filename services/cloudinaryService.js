const cloudinary = require('../config/cloudinary');

/**
 * Uploads a file buffer to Cloudinary
 * 
 * @param {Buffer} fileBuffer File buffer from express-fileupload
 * @param {String} folder Target folder on Cloudinary
 * @returns {Promise<Object>} Object containing secure_url and public_id
 */
const uploadToCloudinary = (fileBuffer, folder = 'ks_study_zone') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve({
          secure_url: result.secure_url,
          public_id: result.public_id
        });
      }
    );
    uploadStream.end(fileBuffer);
  });
};

/**
 * Deletes a file from Cloudinary by public ID
 * 
 * @param {String} publicId Cloudinary file public ID
 * @returns {Promise<Object>} Cloudinary API response
 */
const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return null;
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error(`Failed to delete Cloudinary file: ${publicId}`, error);
    throw error;
  }
};

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary
};
