import Document, { Html, Head, Main, NextScript } from 'next/document'

class MyDocument extends Document {
  static async getInitialProps(ctx) {
    const initialProps = await Document.getInitialProps(ctx)
    return { ...initialProps }
  }

  render() {
    return (
      <Html>
        <Head>
        <link rel="stylesheet"
                href="//mwf-service.akamaized.net/mwf/css/bundle/1.56.0/west-european/default/mwf-west-european-default.min.css">

        </link>
        </Head>
        
        <body>
          <Main />
          <NextScript />
          <script async="async"
                src="https://mwf-service.akamaized.net/mwf/js/bundle/1.56.0/mwf-auto-init-main.var.min.js"></script>
        </body>
      </Html>
    )
  }
}

export default MyDocument