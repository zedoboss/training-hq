MediaPipe Tasks Vision 1.1.0 (@mediapipe/tasks-vision, Apache License 2.0) and the Pose Landmarker models
(pose_landmarker_lite.task, pose_landmarker_full.task), vendored unmodified, as in the Squat Depth app.
The app keeps these files in their own offline store on the phone (see scripts/sw.template.js), not in the
per-version app files, so an app update never downloads them again.
