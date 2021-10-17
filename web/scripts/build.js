
'use strict';

import { fileURLToPath } from 'url';
import path, { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import rimraf from 'rimraf'
import webpack from 'webpack'

const isProduction = process.env.NODE_ENV === 'production';
rimraf.sync(path.resolve(__dirname, '../build'));
webpack(
    {
        mode: isProduction ? 'production' : 'development',
        devtool: isProduction ? 'source-map' : 'cheap-module-source-map',
        entry: [path.resolve(__dirname, '../src/ssr_hydrate.js')],
        output: {
            path: path.resolve(__dirname, '../build/js'),
            filename: 'main.js',
        },
        module: {
            rules: [
                {
                    test: /\.js$/,
                    use: 'babel-loader',
                    exclude: /node_modules/,
                },
            ],
        },
        plugins: [
            new webpack.DefinePlugin({
                'process.env': {
                    NODE_ENV: JSON.stringify('production'),
                    ...(process.env.REACT_APP_FACTORY_PORT && { REACT_APP_FACTORY_PORT: process.env.REACT_APP_FACTORY_PORT }),
                    ...(process.env.REACT_APP_ORDERING_PORT && { REACT_APP_ORDERING_PORT: process.env.REACT_APP_ORDERING_PORT }),
                },
            }),
        ],
    },
    (err, stats) => {
        if (err) {
            console.error(err.stack || err);
            if (err.details) {
                console.error(err.details);
            }
            process.exit(1);
            return;
        }
        const info = stats.toJson();
        if (stats.hasErrors()) {
            console.log('Finished running webpack with errors.');
            info.errors.forEach(e => console.error(e));
            process.exit(1);
        } else {
            console.log('Finished running webpack.');
        }
    }
);
