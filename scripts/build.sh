#!/bin/bash
cp /etc/redis/redis_pass .
sudo docker build --tag webrtc-signaling-server:${1} .
rm redis_pass
