# Lyrics from a folder, in Docker (a NAS, Umbrel): mount your lyrics at /lyrics and keep /state for its key.
#   docker build -t lyrics-from-folder . && docker run -d --network host -v /volume1/lyrics:/lyrics:ro -v lff-state:/state lyrics-from-folder
FROM python:3.12-alpine
RUN pip install --no-cache-dir infinity-core-api[discovery]
COPY lyrics_from_folder.py /app/
ENV LYRICS_FOLDER=/lyrics HOME=/state
CMD ["python", "/app/lyrics_from_folder.py"]
