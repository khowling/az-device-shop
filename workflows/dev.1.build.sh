#!/bin/bash
set -e

echo "Clean up.."
rm -fr ./node_modules
find . -name node_modules -type d -prune -exec rm -fr {} \;

find . -name lib -type d -prune -exec rm -fr {} \;
find . -name out -type d -prune -exec rm -fr {} \;

echo "Install Dependencies.."
# legacy-peer-deps required for @fluentui to work with react18 :(
npm i --legacy-peer-deps

echo "Build Eventing.."
cd common/eventing
#npm i
npm run build

echo "Build Workflow.."
cd ../../common/workflow
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