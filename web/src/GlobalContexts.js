import React from 'react'

// Context lets us pass a value deep into the component tree
// without explicitly threading it through every component.

// Context is designed to share data that can be considered “global” for a tree of React components, such as the current authenticated user, theme, or preferred language.

// IMPORTANT: The defaultValue argument is only used when a component does not have a matching Provider above it in the tree

// renderContext = { 
//    ssrContext: "server"
//    serverInitialData: (from App.js => AppRouteCfg)
//    session = {
//        tenent: 
//        auth: { userid: , given_name:  }
//        cart_items: numbrt
//    }

export const RenderContext = React.createContext(null)
export const TenentContext = React.createContext(null)

export const AuthContext = React.createContext()
export const CartCountContext = React.createContext()

export const CartOpenContext = React.createContext()
