#!/bin/bash
npm i --legacy-peer-deps

echo "Build Eventing.."
cd common/eventing
#npm i
npm run build

echo "Build Factory.."
cd ../../factory 
#npm i
npm run build

echo "Build Ordering.."
cd ../ordering
#npm i
npm run build

echo "Build Web.."
cd ../web/web-react
#npm i --legacy-peer-deps
npm run-script build_lib
npm run-script build_assets_dev

cd ../web-server
#npm i 
npm run build