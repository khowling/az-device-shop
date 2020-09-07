const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const CopyPlugin = require('copy-webpack-plugin');
const HtmlReplaceWebpackPlugin = require('html-replace-webpack-plugin')
const PUBLIC_PATH = "/_assets_"
const BUILD_PATH = './build'
const mode = process.env.NODE_ENV || 'development'

const path = require('path'); module.exports = {
  mode,
  devtool: "source-map",
  target: 'web',
  entry: './src/ssr_client.js',
  output: {
    path: path.resolve(__dirname, BUILD_PATH),
    filename: "[name].js",
    publicPath: PUBLIC_PATH
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react'],
            plugins: [
              [ // Required for client side async/await
                "@babel/plugin-transform-runtime",
                {
                  "absoluteRuntime": false,
                  "corejs": false,
                  "helpers": false,
                  "regenerator": true,
                  "useESModules": false
                }
              ]
            ]
          }
        }
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: 'public/index.html'
    }),
    new HtmlReplaceWebpackPlugin([
      {
        pattern: '%PUBLIC_URL%',
        replacement: PUBLIC_PATH
      }
    ]),
    new webpack.EnvironmentPlugin({
      NODE_ENV: mode,
      BUILD_TARGET: "client"
    }),
    new CopyPlugin({
      patterns: [
        {
          from: 'public/favicon.ico',
          to: path.resolve(__dirname, BUILD_PATH),
        }, {
          from: 'public/manifest.json',
          to: path.resolve(__dirname, BUILD_PATH),
        }
      ]
    })
  ]
}
