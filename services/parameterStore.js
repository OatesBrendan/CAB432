const { SSMClient, GetParametersCommand } = require("@aws-sdk/client-ssm");

const ssmClient = new SSMClient({ region: "ap-southeast-2" });

// Parameter names for your application
const PARAMS = [
  "/n11610557/api-url",
  "/n11610557/database-host", 
  "/n11610557/s3-bucket"
];

async function getAppParameters() {
  try {
    const response = await ssmClient.send(new GetParametersCommand({
      Names: PARAMS,
      WithDecryption: true
    }));

    // Convert to simple object
    const params = {};
    response.Parameters.forEach(p => {
      params[p.Name] = p.Value;
    });

    return params;
  } catch (error) {
    console.error('Parameter Store error:', error.message);
    throw error;
  }
}

module.exports = { getAppParameters };
