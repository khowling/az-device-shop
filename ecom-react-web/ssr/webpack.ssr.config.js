const path = require('path')
const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')
var HtmlReplaceWebpackPlugin = require('html-replace-webpack-plugin')

const publicPath = "/_assets_"

module.exports =  [
// Client
{
  mode: "development",
  entry: "./ssr/client.js",
  target: 'web',
  output: {
    // requires absolute path
    path: path.resolve(__dirname, '../static'),
    filename: "[name].[chunkhash:8].js",
    publicPath : publicPath
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
        replacement: publicPath
      }
    ]),
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development',
      BUILD_TARGET: "client"
    })
  ]
},
// Server
{
  mode: "development",
  entry: "./ssr/server.js",
  target: 'node',
  output: {
    // requires absolute path
    path: path.resolve(__dirname, '../static'),
    filename: "server.js", //"[name].[chunkhash:8].js"
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
      NODE_ENV: 'development',
      PORT: 3000,
      HOST: "localhost",
      BUILD_TARGET: "server"
    })
  ]
}]