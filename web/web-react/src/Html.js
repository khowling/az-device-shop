import React from 'react';

export default function Html({ children, title, hydrate_data, hydrate_tenent }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <link rel="icon" href="/public/favicon.ico" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="manifest" href="/public/manifest.json" />
                <link rel="stylesheet" type="text/css" href="https://assets.onestore.ms/cdnfiles/external/mwf/long/v1/v1.26.1/css/mwf-west-european-default.css" />
                <title>{title}</title>
            </head>
            <body id="root">
                {children}
                <div id="modal-root"></div>
                <script dangerouslySetInnerHTML={{
                    __html: `
                        window.__HYDRATE__TENENT__ = ${JSON.stringify(hydrate_tenent)};
                        window.__HYDRATE__DATA__ = { read() { return ${JSON.stringify(hydrate_data)}}};
                        `
                }} />
                <script src="/static/js/main.js"></script>
                <script async="async"
                    src="https://assets.onestore.ms/cdnfiles/external/mwf/long/v1/v1.26.1/scripts/mwf-auto-init-main.var.min.js"></script>
            </body>
        </html>
    );
}