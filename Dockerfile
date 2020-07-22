FROM node
COPY . /app/webrtc-signaling-server
RUN mkdir /etc/redis
COPY redis_pass /etc/redis
WORKDIR /app/webrtc-signaling-server

RUN [ "npm", "i" ]
RUN [ "npm", "audit", "fix", "--force" ]
CMD [ "npm", "start" ]
