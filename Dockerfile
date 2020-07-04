FROM node
COPY . /app/webrtc-signaling-server

WORKDIR /app/webrtc-signaling-server

RUN [ "npm", "i" ]
RUN [ "npm", "audit", "fix", "--force" ]
CMD [ "npm", "start" ]
