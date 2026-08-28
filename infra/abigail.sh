server {
    listen 80;
    listen 443 ssl;
    server_name abigail.sh murph.sh phoebe.sh abigail.phoebe.sh abigail.phoebe.murph.sh;
    ssl_certificate /var/www/cert.pem;
    ssl_certificate_key /var/www/key.pem;
    client_max_body_size 15m;
    client_body_timeout 120s;
    add_header Strict-Transport-Security 'max-age=31536000; includeSubDomains' always;

    client_header_buffer_size 4k;
    large_client_header_buffers 4 16k;

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