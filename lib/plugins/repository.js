//const { restEndpointMethods } = require('@octokit/plugin-rest-endpoint-methods')
//const EndPoints = require('@octokit/plugin-rest-endpoint-methods')
const NopCommand = require('../nopcommand')
const MergeDeep = require('../mergeDeep')
const ignorableFields = [
  "id",
  "node_id",
  "full_name",
  "private",
  "fork",
  "created_at",
  "updated_at",
  "pushed_at",
  "size",
  "stargazers_count",
  "watchers_count",
  "language",
  "has_wiki",
  "has_pages",
  "forks_count",
  "archived",
  "disabled",
  "open_issues_count",
  "license",
  "allow_forking",
  "is_template",
 // "topics",
  "visibility",
  "forks",
  "open_issues",
  "watchers",
  "permissions",
  "temp_clone_token",
  "allow_merge_commit",
  "allow_rebase_merge",
  "allow_auto_merge",
  "delete_branch_on_merge",
  "organization",
  "security_and_analysis",
  "network_count",
  "subscribers_count",
  "mediaType",
  "owner",
  "org",
  "force_create",
  "auto_init",
  "repo"
]

module.exports = class Repository {
  constructor (nop, github, repo, settings, installationId, log) {
    this.installationId = installationId
    this.github = github
    this.settings = Object.assign( { mediaType: { previews: ['nebula-preview'] } }, settings, repo)
    this.topics = this.settings.topics
    this.repo = repo
    this.log = log
    this.nop = nop
    this.force_create = this.settings.force_create
    this.codeowners = this.settings.codeowners
    this.template = this.settings.template
    //delete this.settings.topics
    delete this.settings.force
    delete this.settings.template
  }
  
  sync () {
    const resArray = []
    this.log.debug(`Syncing Repo ${this.settings.name}`)
    this.settings.name = this.settings.name || this.settings.repo
    
    return this.github.repos.get(this.repo)
    .then( resp => {
      if (this.nop) {
        try {
          const mergeDeep = new MergeDeep(this.log,ignorableFields)
          const results = JSON.stringify(mergeDeep.compareDeep(resp.data, this.settings),null,2)
          this.log(`Result of compareDeep = ${results}`)
          resArray.push(new NopCommand("Repository", this.repo, null, `Followings changes will be applied to the repo settings = ${results}`))
        } catch(e){
          this.log.error(e)
        }
      }

      if (this.settings.default_branch && (resp.data.default_branch !== this.settings.default_branch)) {
        return this.renameBranch(resp.data.default_branch,this.settings.default_branch).then()
      } 
    })
    .then(res => {
      resArray.concat(res)
      // Remove topics as it would be handled seperately
      delete this.settings.topics
      // TODO May have to chain the nop results
      return this.updaterepo().then( res => {
        this.log(`Successfully updated the repo`)
        return resArray.concat(res)
      }).catch(e => {this.log(`Error ${JSON.stringify(e)}`)})
    })
    .catch(e => {
      if (e.status === 404) {
        if (this.force_create) {
          if (this.template) {
            this.log(`Creating repo using template ${this.template}`)
            const options = {template_owner: this.repo.owner, template_repo: this.template, owner: this.repo.owner, name: this.repo.repo, private: (this.settings.private?this.settings.private:true), description: this.settings.description?this.settings.description:"" }

            if (this.nop) {
              this.log.debug(`Creating Repo using template ${JSON.stringify(this.github.repos.createInOrg.endpoint(this.settings))}  `)
              return Promise.resolve([
                new NopCommand(this.constructor.name, this.repo, this.github.repos.createUsingTemplate.endpoint(options),"Create Repo Using Template"),
              ])
            }
            return this.github.repos.createUsingTemplate(options).then( () => {
              return this.updaterepo()
            })
          } else {
            this.log('Creating repo with settings ', this.settings)
            if (this.nop) {
              this.log.debug(`Creating Repo ${JSON.stringify(this.github.repos.createInOrg.endpoint(this.settings))}  `)
              return Promise.resolve([
                new NopCommand(this.constructor.name, this.repo, this.github.repos.createInOrg.endpoint(this.settings),"Create Repo"),
              ])
            }
            return this.github.repos.createInOrg(this.settings).then( () => {
              return this.updaterepo()
            })
          }

        } else {
          if (this.nop) {
            return Promise.resolve([
              new NopCommand(this.constructor.name, this.repo, null,"Force_create is false. Skipping repo creation"),
            ])
          }

        }
      } else {
        this.log.error(` Error ${JSON.stringify(e)}`)
      }
    })
  }

  renameBranch (oldname, newname) {
    const parms = {
      owner: this.settings.owner,
      repo: this.settings.repo,
      branch: oldname,
      new_name: newname
    }
    this.log.debug(`Rename default branch repo with settings ${JSON.stringify(parms)}`)
    if (this.nop) {
      return Promise.resolve([
        new NopCommand(this.constructor.name, this.repo, this.github.repos.renameBranch.endpoint(parms),"Rename Branch"),
      ])
    }
    return this.github.repos.renameBranch(parms)
  }

  updaterepo() {
    const parms = {
      owner: this.settings.owner,
      repo: this.settings.repo,
      //names: this.topics.split(/\s*,\s*/),
      names: this.topics,
      mediaType: {
        previews: ['mercy']
      }
    }

    this.log.debug(`Updating repo with settings ${JSON.stringify(this.topics)} ${JSON.stringify(this.settings)}`)
    if (this.nop) {
      let result = [
        new NopCommand(this.constructor.name, this.repo, this.github.repos.update.endpoint(this.settings),"Update Repo"),
      ]
      if (this.topics) {
        result.push(new NopCommand(this.constructor.name, this.repo, this.github.repos.replaceAllTopics.endpoint(parms),"Update Topics"))
      }
      return Promise.resolve(result)
    }

    return this.github.repos.update(this.settings).then((updatedRepo) => {
      this.updatetopics(parms, updatedRepo)
      this.updateCodeOwners(updatedRepo)
    })
  }

  updatetopics(parms, repoData) {
    if (this.topics) {
      if (repoData.data?.topics.length !== this.topics.length ||
        !repoData.data?.topics.every(t => this.topics.includes(t))) {
        this.log(`Updating repo with topics ${this.topics.join(",")}`)
        return this.github.repos.replaceAllTopics(parms)
      } else {
        this.log(`no need to update topics for ${repoData.data.name}`)
      }
    }
  }

  async updateCodeOwners(repoData) {
    this.log.debug(`repoData: ${JSON.stringify(repoData)}`)
    if (this.codeowners) {
      if (this.codeowners == true){
        if(await this.doesCodeOwnersExist(repoData)){
          this.log(`Codeowners already exists for ${repoData.data.name}`)
          return
        }
        else{
          this.log(`Codeowners doesn't exist for ${repoData.data.name}. Creating pull request.`)
          const newCodeOwner = await this.findCodeOwner(repoData)
          return
        }
        
      } else {
        this.log(`No need to update codeowners for ${repoData.data.name}`)
      }
    }
  }

  async findCodeOwner(repoData){
    let codeOwner

    //check for who commits the most

    //if it's a new repo and no commits are found, find who created the repo
    try
    {
      const res = await octokit.rest.activity.listRepoEvents({owner: repoData.data.owner.login, repo: repoData.data.name});
      for (gh_event of res.data){
        if(gh_event.type === "CreateEvent" && gh_event.payload.ref_type === "repository"){
          codeOwner = gh_event.actor.login
        }
      }
    }
    catch (error)
    {
      console.log(`Error checking for CreateEvent ${error}`)
    }


  }

  async doesCodeOwnersExist(repoData) {
    this.log(`Checking if repo ${repoData.data.name} already has a CODEOWNERS file...`);
    // per https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-file-location
    if (await this.getCodeOwnersContent(repoData, 'CODEOWNERS')) return true;
    if (await this.getCodeOwnersContent(repoData, 'docs/CODEOWNERS')) return true;
    if (await this.getCodeOwnersContent(repoData, '.github/CODEOWNERS')) return true;
    return false;
  }

  async getCodeOwnersContent(repoData, path){
    let codeOwnersPayload = {owner: repoData.data.owner.login, repo: repoData.data.name, path: path};

    const response = await this.github.repos.getContent(codeOwnersPayload).catch(e => {
      this.log.error(`Error getting codeownersfile ${JSON.stringify(codeOwnersPayload)} ${e}`);
      return false;
    })
    return response.status;
  }
      
    


}
