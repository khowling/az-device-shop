import React from 'react';

export default function Html({ children, title }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />

                <link rel="stylesheet" href="https://assets.onestore.ms/cdnfiles/external/mwf/long/v1/v1.26.1/css/mwf-west-european-default.css" />
                <title>{title}</title>
            </head>
            <body>
                {children}
                <script src="/static/js/main.js"></script>
            </body>
        </html>
    );
}