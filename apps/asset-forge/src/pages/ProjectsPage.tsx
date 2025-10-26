/**
 * Projects Page
 * Project management and collaboration
 */

import { FolderOpen, Plus, Grid, List, Clock, Star } from 'lucide-react'
import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button, Badge } from '@/components/common'

export function ProjectsPage() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  // Sample projects data structure (will be replaced with real data later)
  const projects = [
    { id: 1, name: 'Game Assets Pack', description: 'Core game assets for fantasy RPG', assetCount: 127, lastModified: '2 hours ago', status: 'active' },
    { id: 2, name: 'Character Models', description: 'Player and NPC character models', assetCount: 43, lastModified: '1 day ago', status: 'active' },
    { id: 3, name: 'Environment Pack', description: 'Trees, rocks, and landscape assets', assetCount: 89, lastModified: '3 days ago', status: 'archived' },
  ]

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <div className="bg-bg-secondary border-b border-border-primary backdrop-blur-md">
        <div className="max-w-[1920px] mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary/10 rounded-lg border border-primary/20 backdrop-blur-sm">
                <FolderOpen className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-text-primary">Projects</h1>
                <p className="text-text-secondary mt-1">Organize and manage your asset collections</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex bg-bg-tertiary rounded-lg p-1 border border-border-primary">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-3 py-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
              <Button variant="primary" className="gap-2">
                <Plus className="w-4 h-4" />
                New Project
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1920px] mx-auto px-6 py-6">
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' : 'space-y-4'}>
          {projects.map(project => (
            <Card key={project.id} className="bg-bg-secondary border-border-primary backdrop-blur-md hover:border-primary/50 transition-all">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-5 h-5 text-primary" />
                    <CardTitle>{project.name}</CardTitle>
                  </div>
                  <Star className="w-4 h-4 text-text-tertiary hover:text-warning cursor-pointer" />
                </div>
                <CardDescription>{project.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1 text-text-secondary">
                    <Grid className="w-4 h-4" />
                    <span>{project.assetCount} assets</span>
                  </div>
                  <div className="flex items-center gap-1 text-text-secondary">
                    <Clock className="w-4 h-4" />
                    <span>{project.lastModified}</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex items-center justify-between">
                <Badge variant={project.status === 'active' ? 'default' : 'secondary'}>
                  {project.status}
                </Badge>
                <Button variant="ghost" size="sm">Open</Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
