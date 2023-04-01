import { useState } from 'react'
import { httpBatchLink, createWSClient, wsLink } from '@trpc/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { trpc } from './trpc';
import IndexPage  from './pages/home';


//const ws_url = process.env.REACT_APP_ORDERING_PORT ? `ws://${window.location.hostname}:${process.env.REACT_APP_ORDERING_PORT}` : `wss://${window.location.hostname}/ws/ordering/`
const wsClient = createWSClient({
  url: `ws://localhost:5000/trpc`,
});

function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      
      links: [
        wsLink({
          client: wsClient,
        }),
        httpBatchLink({
          url: 'http://localhost:5000/trpc',
          // optional
          headers() {
            return {
              authorization: 'none',
            };
          },
        }),
      ],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <IndexPage/>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

export default App;