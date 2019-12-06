import React from 'react'

// Context lets us pass a value deep into the component tree
// without explicitly threading it through every component.0

// The defaultValue argument is only used when a component does not have a matching Provider above it in the tree
const RenderContext = React.createContext({})

export default RenderContext