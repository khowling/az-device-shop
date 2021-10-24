import React from 'react'

// Context lets us pass a value deep into the component tree
// without explicitly threading it through every component.

// Context is designed to share data that can be considered “global” for a tree of React components, such as the current authenticated user, theme, or preferred language.

// IMPORTANT: The defaultValue argument is only used when a component does not have a matching Provider above it in the tree



// Tentnet State
// === ctx.tenent
//  null if development server (npm start)
export const TenentContext = React.createContext(null)

// RenderContext 
//  set to a Suspense object, for SSR phases: initial render and hydrate
//    read(): {
//       ssrContext:
//       serverInitialData: 
//       reqUrl: 
//    }
//  null if development server (npm start)
export const RenderContext = React.createContext(null)




export const AuthContext = React.createContext()

export const CartCountContext = React.createContext()

export const CartOpenContext = React.createContext()
