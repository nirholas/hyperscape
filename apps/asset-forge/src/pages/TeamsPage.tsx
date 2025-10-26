/**
 * Teams Page
 * Team collaboration and member management
 */

import { Users2, Plus, Crown, User, Mail, Shield } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button, Badge } from '@/components/common'

export function TeamsPage() {
  // Sample teams data structure (will be replaced with real data later)
  const teams = [
    {
      id: 1,
      name: 'Core Development',
      description: 'Main asset development team',
      memberCount: 8,
      role: 'owner',
      members: [
        { id: 1, name: 'John Doe', email: 'john@example.com', role: 'owner' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'admin' },
        { id: 3, name: 'Bob Johnson', email: 'bob@example.com', role: 'member' },
      ]
    },
    {
      id: 2,
      name: 'Art Department',
      description: 'Character and environment artists',
      memberCount: 12,
      role: 'admin',
      members: []
    },
    {
      id: 3,
      name: 'Quality Assurance',
      description: 'Testing and validation team',
      memberCount: 5,
      role: 'member',
      members: []
    },
  ]

  const getRoleBadge = (role: string) => {
    const variants: Record<string, 'default' | 'secondary'> = {
      owner: 'default',
      admin: 'default',
      member: 'secondary'
    }
    return <Badge variant={variants[role] || 'secondary'}>{role}</Badge>
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <div className="bg-bg-secondary border-b border-border-primary backdrop-blur-md">
        <div className="max-w-[1920px] mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary/10 rounded-lg border border-primary/20 backdrop-blur-sm">
                <Users2 className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-text-primary">Teams</h1>
                <p className="text-text-secondary mt-1">Collaborate with your team members on asset projects</p>
              </div>
            </div>
            <Button variant="primary" className="gap-2">
              <Plus className="w-4 h-4" />
              Create Team
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1920px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {teams.map(team => (
            <Card key={team.id} className="bg-bg-secondary border-border-primary backdrop-blur-md">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Users2 className="w-5 h-5 text-primary" />
                    <CardTitle>{team.name}</CardTitle>
                  </div>
                  {getRoleBadge(team.role)}
                </div>
                <CardDescription>{team.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <User className="w-4 h-4" />
                    <span>{team.memberCount} members</span>
                  </div>

                  {/* Show members for first team only (expandable in real implementation) */}
                  {team.members.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm font-semibold text-text-primary">Team Members</p>
                      {team.members.map(member => (
                        <div key={member.id} className="flex items-center justify-between p-2 bg-bg-tertiary rounded-lg border border-border-primary">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                              <User className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-text-primary">{member.name}</p>
                              <p className="text-xs text-text-tertiary flex items-center gap-1">
                                <Mail className="w-3 h-3" />
                                {member.email}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {member.role === 'owner' && <Crown className="w-4 h-4 text-warning" />}
                            {member.role === 'admin' && <Shield className="w-4 h-4 text-primary" />}
                            <Badge variant="secondary" className="text-xs">{member.role}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex items-center justify-between">
                <Button variant="ghost" size="sm">Manage</Button>
                <Button variant="ghost" size="sm" className="gap-2">
                  <Plus className="w-4 h-4" />
                  Invite
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
