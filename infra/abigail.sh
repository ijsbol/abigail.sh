server {
    listen 80;
    listen 443 ssl;
    server_name abigail.sh murph.sh phoebe.sh abigail.phoebe.sh abigail.phoebe.murph.sh;
    ssl_certificate /var/www/cert.pem;
    ssl_certificate_key /var/www/key.pem;
    client_max_body_size 15m;
    client_body_timeout 120s;
    add_header Strict-Transport-Security 'max-age=31536000; includeSubDomains' always;

    # legacy versions of the site set multi-MB cookies; allow oversized request
    # headers so browsers still holding them don't get 400/431 rejected.
    client_header_buffer_size 64k;
    large_client_header_buffers 8 1m;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml application/font-woff font/woff2;
    gzip_min_length 256;

    location /static/ {
        alias /opt/websites/abigail.sh/_served/static/;
        access_log off;
        tcp_nodelay off;
        sendfile on;
        location ~* \.(css|js|woff2?|ttf|otf)$ {
            add_header Cache-Control "public, max-age=31536000, immutable";
        }
        location ~* \.(avif|png|jpe?g|gif|svg|webp|json)$ {
            add_header Cache-Control "public, max-age=86400";
        }
    }

    # webSocket endpoint needs the upgrade handshake and a long idle timeout,
    # otherwise nginx tears the connection down after proxy_read_timeout.
    location /ws/ {
        proxy_pass http://127.0.0.1:7867;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # the cursors WS is anonymous and reads no cookies. Strip the Cookie
        # header so a large cookie can't blow past the websockets handshake
        # header-size limit (surfaces as 431 Request Header Fields Too Large).
        proxy_set_header Cookie "";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:7867;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}