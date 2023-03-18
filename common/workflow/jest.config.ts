
import type { Config } from "@jest/types"
import path from 'path'

const config: Config.InitialOptions = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',

  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@az-device-shop/(.*)/(.*)$': path.resolve(__dirname, './$1')
  },
  transform: {
    // '^.+\\.[tj]sx?$' to process js/ts with `ts-jest`
    // '^.+\\.m?[tj]sx?$' to process js/ts/mjs/mts with `ts-jest`
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
}
export default config