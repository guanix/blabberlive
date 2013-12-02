Messages = new Meteor.Collection('messages');

Router.map(function () {
  var monthAgo = moment().subtract('months', 1);

  this.route('home', {
    path: '/',
    before: function () {
      this.subscribe('threadRoots').wait();
    },
    data: function () {
      return {
        threads: Messages.find({
          parent: null,
          threadLastDate: {$gt: monthAgo}
        }, {sort: {threadLastDate: -1}})
      };
    }
  });

  this.route('thread', {
    path: '/thread/:_id',
    before: function () {
      this.subscribe('threadMessages', this.params._id).wait();
      this.subscribe('threadRoots').wait();
    },
    data: function () {
      var parent = this.params._id;
      var parentMessage = Messages.findOne({parent: null, _id: parent});
      var messages = Messages.find({thread: parent}, {sort: {receivedDate: 1}});
      return {
        parentMessage: parentMessage,
        messages: messages,
        messageCount: messages.count()
      };
    }
  });

  this.route('source', {
    path: '/source/:_id',
    before: function () {
      this.subscribe('messageById', this.params._id).wait();
    },
    data: function () {
      return Messages.findOne({_id: this.params._id});
    }
  })
});

if (Meteor.isClient) {
  $(function () {
    $(document).tooltip({
      track: false,
      show: {
        effect: "show",
        delay: 0
      },
      hide: {
        effect: "hide",
        delay: 0
      }
    });
  });

  Handlebars.registerHelper('formatDate', function (date) {
    return moment(date).format('MM/DD HH:mm');
  });

  Handlebars.registerHelper('formatLongDate', function (date) {
    return moment(date).format('YYYY-MM-DD H:mm:ss');
  });

  Handlebars.registerHelper('threadCount', function (children) {
    return children.length + 1;
  });

  marked.setOptions({
    gfm: true,
    breaks: false,
    tables: false,
    sanitize: true
  });

  Handlebars.registerHelper('marked', function (md) {
    return marked(md);
  });
}

if (Meteor.isServer) {
  Meteor.startup(function () {
    Messages._ensureIndex({receivedDate: 1});
    Messages._ensureIndex({receivedDate: -1});
    Messages._ensureIndex({parent: 1, threadLastDate: -1});
    Messages._ensureIndex({thread: 1, receivedDate: 1});
    Messages._ensureIndex({fromEmail: 1});
    Messages._ensureIndex({subject: 1});
    Messages._ensureIndex({messageIdSha1: 1});

    var monthAgo = new Date(moment().subtract('months', 1));

    console.log(monthAgo);

    Meteor.publish('threadMessages', function (parent) {
      return Messages.find({thread: parent}, {sort: {receivedDate: 1}});
    });

    Meteor.publish('threadRoots', function () {
      return Messages.find({
        parent: null,
        threadLastDate: {$gt: monthAgo}
      }, {
        sort: {threadLastDate: -1}
      });
    });

    Meteor.publish('messageById', function (_id) {
      return Messages.find({_id: _id});
    });
    
    Messages.allow({
      insert: function (userId, party) {
        return false;
      }
    });

    var authToken = process.env.REST_TOKEN;
    console.log("REST auth token is " + authToken);

    collectionApi = new CollectionAPI({
      authToken: authToken,
      apiPath: 'collectionapi',
      standAlone: false,
      listenHost: '127.0.0.1'
    });

    collectionApi.addCollection(Messages, 'messages', {
      authToken: authToken,
      methods: ['POST','GET'],
      before: {
        POST: function (obj) {
          obj.date = new Date(obj.date);
          obj.receivedDate = new Date(obj.receivedDate);
          obj.threadFirstDate = obj.receivedDate;
          obj.threadLastDate = obj.receivedDate;
          obj.threadLastMessage = JSON.parse(JSON.stringify(obj));
          obj.thread = obj._id;

          // need to check for existence before we start messing with the tree
          if (Messages.findOne({_id: obj._id})) {
            // already exists
            console.log(obj._id + ' already exists');
            return false;
          }

          // Run the JWZ threading algorithm, flattened version

          var parent, parentId;

          // walk through the references, left to right, to find a parent
          // unlike JWZ, we are only interested in ultimate parents,
          // hence left to right
          if (obj.references.length) {
            var refCount = obj.references.length - 1;
            for (var i = 0; i < refCount && !parent; i++) {
              var potentialParentId = obj.references[i];
              var potentialParent = Messages.findOne({_id: potentialParentId});
              if (potentialParent) {
                // if the potential parent already has a parent, use that parent
                if (potentialParent.parent) {
                  parentId = potentialParent.parent;
                  parent = Messages.findOne({_id: parentId});
                } else {
                  parent = potentialParent;
                  parentId = potentialParentId;                  
                }
                break;
              }
            }
          }

          // no parent, either because no references or because no parent object found
          if (!parent) {
            // parent does not exist, treat as root, search for parent by subject
            // we will accept same subject within a week
            // pick newest such thread
            console.log('specified parent ' + parentId + ' does not exist, looking by subject: ' + obj.subject);
            if (obj.flags.noSubject) {
              console.log("no subject, so can't look by subject; continuing");
              return true;
            }
            var parentFreshness = new Date(new Date(obj.receivedDate) - 86400*28*1000);
            var subjectParent = Messages.findOne({
              subject: obj.subject,
              parent: null,
              threadLastDate: {$gt: parentFreshness}
            }, {sort: {threadLastDate: -1}, limit: 1});

            if (subjectParent) {
              console.log('assigning subject based parent ' + subjectParent._id);
              parent = subjectParent
            } else {
              console.log('subject based parent not found, continuing');
              return true;
            }
          }

          // update parent field of this message
          obj.parent = parent._id;
          obj.thread = parent._id;

          // update children field of parent
          Messages.update({_id: parent._id}, {$push: {children: obj._id}});

          // update threadLastDate of parent if greater
          Messages.update({_id: parent._id, threadLastDate: {$lt: obj.receivedDate}},
            {$set: {
              threadLastDate: obj.receivedDate,
              threadLastMessage: JSON.parse(JSON.stringify(obj))}
            });

          // clear threadFirstDate and threadLastDate
          obj.threadFirstDate = null;
          obj.threadLastDate = null;
          obj.threadLastMessage = null;

          console.log('message was in thread ' + parent.subject);

          return true;
        }
      }
    });

    collectionApi.start();
  });
}
