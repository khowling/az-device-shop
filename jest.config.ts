
import type { Config } from "@jest/types"

const config: Config.InitialOptions = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',

  
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@az-device-shop/(.*)$': '<rootDir>/common/$1'
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
  transformIgnorePatterns: ["node_modules/(?!(@az-device-shop)/)", "node_modules/@az-device-shop/eventing"]
}
export default config