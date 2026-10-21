FROM nginx:1.30.6-alpine

LABEL org.opencontainers.image.title="qr-airgap-transfer"
LABEL org.opencontainers.image.description="Static QR air-gap file transfer web app"

RUN rm -rf /usr/share/nginx/html/*
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY index.html sender.html receiver.html README.md start-mac.command start-windows.bat /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/
COPY vendor/ /usr/share/nginx/html/vendor/

RUN nginx -t

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
