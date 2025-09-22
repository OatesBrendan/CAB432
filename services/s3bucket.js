const {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  PutBucketTaggingCommand,
} = require("@aws-sdk/client-s3");

const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const s3Client = new S3Client({ region: "ap-southeast-2" });
const bucketName = "n11610557-videos";

async function createBucket() {
  try {
    const command = new CreateBucketCommand({ Bucket: bucketName });
    await s3Client.send(command);
    console.log('Bucket ${bucketName} created');

    await tagBucket();
  } catch (error) {
    if (error.name === "BucketAlreadyOwnedByYou") {
      console.log(`Bucket ${bucketName} already exists`);
    } else {
      console.log("Bucket creation error:", error.message);
      throw error;
    }
  }
}

async function tagBucket() {
  const command = new PutBucketTaggingCommand({
    Bucket: bucketName,
    Tagging: {
      TagSet: [
        { Key: "qut-username", Value: "n11610557@qut.edu.au" },
        { Key: "purpose", Value: "assessment-2" },
      ],
    },
  });

  try {
    await s3Client.send(command);
    console.log(`Bucket ${bucketName} tagged successfully`);
  } catch (error) {
    console.log("Bucket tagging error:", error.message);
  }
}

async function uploadToS3(fileBuffer, fileName, mimeType) {
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: fileBuffer,
      ContentType: mimeType,
    });

    await s3Client.send(command);
    console.log(`File uploaded to S3: ${fileName}`);

    return {
      bucket: bucketName,
      key: fileName,
      location: `s3://${bucketName}/${fileName}`,
    };
  } catch (error) {
    console.log("S3 upload error:", error.message);
    throw error;
  }
}

async function downloadFromS3(fileName) {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileName,
    });

    const response = await s3Client.send(command);
    return response.Body;
  } catch (error) {
    console.log("S3 download error:", error.message);
    throw error;
  }
}

async function generatePresignedUrl(fileName, expiresIn = 3600) {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileName,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.log("Presigned URL error:", error.message);
    throw error;
  }
}


module.exports = { uploadToS3, downloadFromS3, generatePresignedUrl, bucketName, createBucket };
