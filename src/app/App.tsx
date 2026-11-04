import { createBrowserRouter, RouterProvider } from 'react-router';
import { Shell } from './Shell';
import { HomePage } from '../pages/home/HomePage';
import { ProjectRoute } from './ProjectRoute';
import { NotFound } from '../pages/NotFound';

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

const router = createBrowserRouter(
  [
    {
      element: <Shell />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'projects/:slug', element: <ProjectRoute /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  { basename },
);

export function App() {
  return <RouterProvider router={router} />;
}
