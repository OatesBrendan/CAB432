const express = require('express');
const path = require('path');
const fileUpload = require('express-fileupload');

const app = express();

const { createBucket } = require('./services/s3bucket');
createBucket().catch(console.error);

app.use(express.json());
app.use(fileUpload({
  limits: { fileSize: 100 * 1024 * 1024 },
  useTempFiles: true,
  tempFileDir: '/tmp/'
}));

const indexRouter = require('./routes/indexRoutes');
const uploadRouter = require('./routes/uploadRoutes');
const processRouter = require('./routes/processRoutes');

app.use('/', indexRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/videos', processRouter)

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));