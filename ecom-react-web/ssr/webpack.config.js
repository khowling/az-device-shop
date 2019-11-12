const path = require('path')
const fs = require('fs')
const nodeExternals = require('webpack-node-externals')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

const mode = 'production';
const src = path.resolve(__dirname, '../src');
const dist = path.resolve(__dirname, '../dist');

// https://nckweb.com.ar/a-pain-in-the-react-challenges-behind-ssr/
// https://github.com/NickCis/a-pain-in-the-react-challenges-behind-ssr/tree/master/1-webpack-ssr

// ALT, packaged solution:

// https://github.com/jaredpalmer/razzle/blob/master/packages/razzle/config/createConfig.js


// https://github.com/postcss/postcss-loader

const nodePath = (process.env.NODE_PATH || '')
  .split(path.delimiter)
  .filter(folder => folder && !path.isAbsolute(folder))
  .map(folder => path.resolve(appDirectory, folder))
  .join(path.delimiter);


const appNodeModules = path.resolve(fs.realpathSync(process.cwd()), 'node_modules'),
      resolve = {
        modules: ['node_modules', appNodeModules].concat(
          // It is guaranteed to exist because we tweak it in `env.js`
          nodePath.split(path.delimiter).filter(Boolean)
        ),
        extensions: ['.mjs', '.jsx', '.js', '.json'],
      },
      resolveLoader = {
        modules: [appNodeModules, path.resolve(__dirname, '..', 'node_modules')],
      }

console.log (`resolve : ${JSON.stringify (resolve, null, 2)}`)
console.log (`resolveLoader : ${JSON.stringify (resolveLoader, null, 2)}`)

module.exports = [
  // Client configuration
  {
    mode,
    entry: path.join(__dirname, '../ssr', 'client'),//path.join(src, 'client'),
    output: {
      path: dist,
      filename: 'client.js',
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          include: [src, path.join(__dirname, '../ssr')],
          use: [
            {
              loader: 'babel-loader',
              options: {
                presets: [
                  ['@babel/preset-env', { modules: false }],
                  '@babel/preset-react'
                ],
              },
            },
          ],
        },
        {
          test: /\.css$/,
          exclude: [/build/, /\.module\.css$/],
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: require.resolve('css-loader'),
              options: {
                modules: {
                  localIdentName: '[path]__[name]___[local]'
                },
                importLoaders: 1
              },
            },
            {
              loader: require.resolve('postcss-loader'),
              options: {
                ident: 'postcss',
                plugins: [
                  require('autoprefixer')({}),
                  require('postcss-preset-env')({
                    autoprefixer: {
                      flexbox: 'no-2009',
                    },
                    stage: 3,
                  }),
                  require('cssnano')({ preset: 'default' })
                ],
                minimize: true
              }
            }
          ]
        }
      ],
    },
    plugins: [
    new MiniCssExtractPlugin({
      filename: 'static/css/bundle.[contenthash:8].css',
      chunkFilename: 'static/css/[name].[contenthash:8].chunk.css',
      // allChunks: true because we want all css to be included in the main
      // css bundle when doing code splitting to avoid FOUC:
      // https://github.com/facebook/create-react-app/issues/2415
      allChunks: true,
    })
  ]
  },
  // Server configuration
  {
    mode,
    resolve,
    resolveLoader,
    target: 'node',
    entry: path.join(src, 'App'), // src,
    output: {
      path: dist,
      filename: 'server.js',
     // libraryExport: "umd",
      libraryTarget: 'commonjs2'
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          include: [src],
          use: [
            {
              loader: 'babel-loader',
              options: {
                presets: [
                  ['@babel/preset-env', { targets: { node: 'current' }}],
                  '@babel/preset-react'
                ],
              },
            },
          ],
        },
        {
          test: /\.css$/,
          exclude: [/build/, /\.module\.css$/],
          use: [
            {
              loader: require.resolve('css-loader'),
              options: {
                importLoaders: 1,
              },
            },
          ]
        }
      ],
    },
    externals: [
      nodeExternals(),
    ],
  },
];