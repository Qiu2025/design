<h1 align="center">
  SnapBox
</h1>
<p align="center">
  A compact toolbox for code images, icons, and private metadata cleaning.
</p>

## About

This repository contains the source code for [snap.sqiu.dev](https://snap.sqiu.dev), a collection of small browser tools. It includes:

- [**Code Images**](</app/(navigation)/(code)>): Create beautiful images of your code.
- [**Icon Maker**](</app/(navigation)/icon/>): Create beautiful icons for your apps and projects.
- [**Metadata Remover**](</app/(navigation)/metadata/>): Clean and verify image metadata locally, with local-first video processing and an optional server fallback.

## Setup

To get started, clone the repo, install dependencies and run the development server:

```bash
npm install
npm run dev
```

The server video fallback requires `ffmpeg` and `ffprobe`. When they are not on `PATH`, set `FFMPEG_PATH` and
`FFPROBE_PATH`. The production Docker image installs both tools.

## Credits

This project is built on top of the open-source code from [ray.so](https://github.com/raycast/ray-so) by [Raycast](https://www.raycast.com/).
