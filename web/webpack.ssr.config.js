const path = require('path')
const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')
var HtmlReplaceWebpackPlugin = require('html-replace-webpack-plugin')
const TerserPlugin = require('terser-webpack-plugin');

const PUBLIC_PATH = "/static"
const BUILD_PATH = './build'
const mode = process.env.NODE_ENV || 'development'

console.log(`mode=${mode}`)

module.exports = [
  // Client
  {
    mode: mode,
    entry: "./src/ssr_client.js",
    target: 'web',
    output: {
      // requires absolute path
      path: path.resolve(__dirname, BUILD_PATH, PUBLIC_PATH),
      filename: "[name].[chunkhash:8].js",
      publicPath: PUBLIC_PATH
    },
    devtool: "source-map",
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              presets: [
                "@babel/preset-env",
                "@babel/preset-react"
              ],
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
        },
        {
          test: /\.css$/,
          use: [
            //"style-loader",
            "css-loader"
          ]
        }
      ]
    },
    node: {
      // Resolve: Error: Can't resolve 'fs'
      fs: 'empty',
      "__console": false,
      "__dirname": false,
      "__filename": false
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
      })
    ],
    optimization: {
      minimize: true,
      minimizer: [
        new TerserPlugin({
          include: [/\/src/, /\/ssr/],
        }),
      ],
    }
  },
  // Server
  {
    mode: mode,
    entry: "./src/ssr_server.js",
    target: 'node',
    output: {
      // requires absolute path
      path: path.resolve(__dirname, BUILD_PATH),
      filename: "ssr_server.js",
      libraryTarget: 'commonjs2'
    },
    devtool: "source-map",
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              presets: [
                ["@babel/preset-env", {
                  "targets": {
                    // required for server side async/await
                    "node": "current"
                  }
                }
                ],
                "@babel/preset-react"
              ]
            }
          }
        },
        {
          test: /\.css$/,
          use: [
            //"style-loader",
            "css-loader"
          ]
        }
      ]
    },
    node: {
      // Resolve: Error: Can't resolve 'fs'
      fs: 'empty',
      "__console": false,
      "__dirname": false,
      "__filename": false
    },
    plugins: [
      new webpack.EnvironmentPlugin({
        NODE_ENV: mode,
        PORT: 3000,
        HOST: "localhost",
        BUILD_TARGET: "server"
      })
    ],
    optimization: {
      minimize: true,
      minimizer: [
        new TerserPlugin({
          include: [/\/src/, /\/ssr/],
        }),
      ],
    }
  }]