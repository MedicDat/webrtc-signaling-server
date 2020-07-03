FROM node
COPY . /app/webrtc-signaling-server

WORKDIR /app/webrtc-signaling-server

CMD [ "npm", "i" ]
CMD [ "npm", "start" ]
