#!/bin/bash
set -e

baseDir="${1:-$(pwd)}"


echo "Clean up [${baseDir}].."
rm -fr $baseDir/node_modules
find $baseDir -name node_modules -type d -prune -exec rm -fr {} \;

find $baseDir -name lib -type d -prune -exec rm -fr {} \;
find $baseDir -name out -type d -prune -exec rm -fr {} \;

cd $baseDir
echo "Install Dependencies [$(pwd)].."
# legacy-peer-deps required for @fluentui to work with react18 :(
npm i --legacy-peer-deps

echo "Build Eventing.."
npm run build --workspace=common/eventing

echo "Build Workflow.."
npm run build --workspace=common/workflow

#echo "Build Webserver.."
#npm run build --workspace=common/webserver

echo "Build Factory.."
cd $baseDir/factory/ui
npm run build
cd $baseDir/factory/server
npm run build

echo "Build Ordering.."
cd $baseDir/ordering
#npm i
npm run build

echo "Build Shop.."
cd $baseDir/shop/ui
#npm i --legacy-peer-deps
npm run-script build_lib
npm run-script build_assets_dev

cd $baseDir/shop/server
#npm i 
npm run build